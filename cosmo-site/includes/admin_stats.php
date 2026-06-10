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

/** ---- unified event feed (visits + leads + tips) ---- */

/** One normalized stream of all three event tables. Columns line up across the UNION;
 *  missing fields are '' / NULL per source. Kept as a function so feed + count share it. */
function events_union_sql(): string
{
    return "(
        SELECT created_at AS ts, 'visit' AS kind, '' AS email, COALESCE(country,'') AS country,
               COALESCE(path,'') AS path, COALESCE(ip,'') AS ip, NULL AS amount_paise, '' AS currency, '' AS status
          FROM visits
        UNION ALL
        SELECT created_at, 'lead', email, COALESCE(country,''), '', '', NULL, '', IF(consent=1,'subscribed','')
          FROM leads
        UNION ALL
        SELECT created_at, 'tip', email, '', '', '', amount_paise, COALESCE(NULLIF(currency,''),'INR'), status
          FROM donations
    ) ev";
}

function events_feed(PDO $db, string $type, int $limit, int $offset): array
{
    $limit = max(1, min(200, $limit));
    $offset = max(0, $offset);
    [$where, $params] = events_filter($type);
    $sql = "SELECT * FROM " . events_union_sql() . " $where ORDER BY ts DESC LIMIT $limit OFFSET $offset";
    $st = $db->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
}

function events_count(PDO $db, string $type): int
{
    [$where, $params] = events_filter($type);
    $sql = "SELECT COUNT(*) FROM " . events_union_sql() . " $where";
    $st = $db->prepare($sql);
    $st->execute($params);
    return (int)$st->fetchColumn();
}

/** Build the WHERE clause + params for a kind filter ('all' → no filter). */
function events_filter(string $type): array
{
    return in_array($type, ['visit', 'lead', 'tip'], true)
        ? ['WHERE kind = :k', [':k' => $type]]
        : ['', []];
}
