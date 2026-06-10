<?php
/** Admin analytics data layer: aggregate queries + pure row/money formatters.
 *  Query functions take the shared PDO and return plain arrays the pages render.
 *  amount_paise holds MINOR units of the row's currency (paise/cents/pence). */

require_once __DIR__ . '/db.php';

/** ---- pure formatters (unit-tested; no I/O) ---- */

function currency_symbol(string $cur): string
{
    $map = ['INR' => '₹', 'USD' => '$', 'EUR' => '€', 'GBP' => '£'];
    $cur = strtoupper(trim($cur));
    return $map[$cur] ?? ($cur !== '' ? $cur . ' ' : '₹');
}

/** Minor units + ISO code → display string. INR shows whole rupees (site convention);
 *  the 2-decimal currencies show cents. Empty currency is treated as INR (legacy rows). */
function money_fmt(int $minor, string $cur): string
{
    $cur = strtoupper(trim($cur));
    if ($cur === '') $cur = 'INR';
    $dec = ($cur === 'INR') ? 0 : 2;
    return currency_symbol($cur) . number_format($minor / 100, $dec);
}

/** "Who/what" column for a unified event row. */
function event_who(array $r): string
{
    if (($r['email'] ?? '') !== '') return (string)$r['email'];
    if (trim((string)($r['country'] ?? '')) !== '') return (string)$r['country'];
    return '—';
}

/** "Detail" column for a unified event row, by kind. */
function event_detail(array $r): string
{
    switch ($r['kind'] ?? '') {
        case 'tip':
            return money_fmt((int)($r['amount_paise'] ?? 0), (string)($r['currency'] ?? '')) . ' · ' . (($r['status'] ?? '') ?: 'created');
        case 'lead':
            return ($r['status'] ?? '') === 'subscribed' ? 'subscribed to updates' : 'email captured';
        default: // visit
            $bits = [];
            if (trim((string)($r['country'] ?? '')) !== '') $bits[] = (string)$r['country'];
            $bits[] = ($r['path'] ?? '') !== '' ? (string)$r['path'] : '/';
            if (($r['ip'] ?? '') !== '') $bits[] = (string)$r['ip'];
            return implode(' · ', $bits);
    }
}

/** ---- aggregate queries (take PDO, return arrays) ---- */

function stats_overview(PDO $db): array
{
    $one = fn(string $sql) => (int)$db->query($sql)->fetchColumn();
    return [
        'visits'  => $one('SELECT COUNT(*) FROM visits'),
        'visits7' => $one('SELECT COUNT(*) FROM visits WHERE created_at >= (NOW() - INTERVAL 7 DAY)'),
        'leads'   => $one('SELECT COUNT(*) FROM leads'),
        'tips'    => $one("SELECT COUNT(*) FROM donations WHERE status='paid'"),
    ];
}

/** Continuous daily counts for the last N days (gaps filled with 0 for a clean line). */
function visits_by_day(PDO $db, int $days = 30): array { return daily_series($db, 'visits', '', $days); }
function tips_by_day(PDO $db, int $days = 30): array   { return daily_series($db, 'donations', "status='paid'", $days); }

function daily_series(PDO $db, string $table, string $where, int $days): array
{
    $days = max(1, min(120, $days));
    $cond = $where !== '' ? "AND $where" : '';
    $rows = $db->query("SELECT DATE(created_at) d, COUNT(*) c FROM $table
                        WHERE created_at >= (CURDATE() - INTERVAL $days DAY) $cond
                        GROUP BY DATE(created_at)")->fetchAll();
    $map = [];
    foreach ($rows as $r) $map[$r['d']] = (int)$r['c'];
    $out = [];
    for ($i = $days - 1; $i >= 0; $i--) {
        $d = date('Y-m-d', strtotime("-$i day"));
        $out[] = ['t' => date('M j', strtotime($d)), 'v' => $map[$d] ?? 0];
    }
    return $out;
}

function country_breakdown(PDO $db, int $limit = 8): array
{
    $limit = max(1, min(50, $limit));
    $rows = $db->query("SELECT COALESCE(NULLIF(country,''),'Unknown') label, COUNT(*) value
                        FROM visits GROUP BY COALESCE(NULLIF(country,''),'Unknown')
                        ORDER BY value DESC LIMIT $limit")->fetchAll();
    return array_map(fn($r) => ['label' => (string)$r['label'], 'value' => (int)$r['value']], $rows);
}

/** Paid tips grouped by currency: [['currency'=>'INR','cnt'=>12,'total'=>490000], ...]. */
function currency_totals(PDO $db): array
{
    return $db->query("SELECT COALESCE(NULLIF(currency,''),'INR') currency, COUNT(*) cnt, COALESCE(SUM(amount_paise),0) total
                       FROM donations WHERE status='paid'
                       GROUP BY COALESCE(NULLIF(currency,''),'INR') ORDER BY cnt DESC")->fetchAll();
}

/** ---- event feed (visits + leads + tips) ---- */

/** One normalized SELECT per source table — identical 9 columns/aliases across all
 *  three, so they UNION cleanly for the "all" view and each also stands alone when a
 *  single type is requested. A filtered view selects its source table directly rather
 *  than running the full UNION and filtering a derived `kind` column with `WHERE kind=?`.
 *  That's faster (one table, not three) and avoids MySQL error 1267 ("illegal mix of
 *  collations") when the bound param's collation differs from the derived column's on
 *  mixed-collation hosts (e.g. utf8mb4_unicode_ci tables + a utf8mb4_general_ci link). */
function event_sources(): array
{
    return [
        'visit' => "SELECT created_at AS ts, 'visit' AS kind, '' AS email, COALESCE(country,'') AS country,
                           COALESCE(path,'') AS path, COALESCE(ip,'') AS ip, NULL AS amount_paise, '' AS currency, '' AS status
                      FROM visits",
        'lead'  => "SELECT created_at AS ts, 'lead' AS kind, email AS email, COALESCE(country,'') AS country,
                           '' AS path, '' AS ip, NULL AS amount_paise, '' AS currency, IF(consent=1,'subscribed','') AS status
                      FROM leads",
        'tip'   => "SELECT created_at AS ts, 'tip' AS kind, email AS email, '' AS country,
                           '' AS path, '' AS ip, amount_paise AS amount_paise, COALESCE(NULLIF(currency,''),'INR') AS currency, status AS status
                      FROM donations",
    ];
}

/** Underlying table for a single event type (for cheap COUNTs). '' for 'all'. */
function event_type_table(string $type): string
{
    return ['visit' => 'visits', 'lead' => 'leads', 'tip' => 'donations'][$type] ?? '';
}

/** FROM-source for a feed: one table's SELECT when a type is given, else all three UNION'd.
 *  $type only ever picks a hard-coded SELECT — it is never interpolated into SQL. */
function events_source_sql(string $type): string
{
    $src = event_sources();
    if (isset($src[$type])) return '(' . $src[$type] . ') ev';
    return '(' . implode("\n        UNION ALL\n", array_values($src)) . ') ev';
}

function events_feed(PDO $db, string $type, int $limit, int $offset): array
{
    $limit  = max(1, min(200, $limit));
    $offset = max(0, $offset);
    $sql = "SELECT * FROM " . events_source_sql($type) . " ORDER BY ts DESC LIMIT $limit OFFSET $offset";
    return $db->query($sql)->fetchAll();
}

function events_count(PDO $db, string $type): int
{
    // Filtered → a single-table COUNT (no union, no derived column, no collation '=').
    $table = event_type_table($type);
    if ($table !== '') return (int)$db->query("SELECT COUNT(*) FROM $table")->fetchColumn();
    return (int)$db->query("SELECT COUNT(*) FROM " . events_source_sql('all'))->fetchColumn();
}
