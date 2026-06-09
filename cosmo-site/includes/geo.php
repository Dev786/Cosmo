<?php
/** IP → {country, city}, best-effort via ip-api.com (free, no key, HTTP only on
 *  the free tier). Short timeout so a slow/blocked lookup never delays a request;
 *  on any failure returns empty strings. Skipped for private/empty IPs. */

require_once __DIR__ . '/db.php';

function geo_lookup(string $ip): array
{
    $empty = ['country' => '', 'city' => ''];
    $cfg = cosmo_config();
    if (!$cfg || empty($cfg['geo_enabled']) || $ip === '') return $empty;
    if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false) {
        return $empty; // localhost / private — nothing to resolve
    }

    $url = "http://ip-api.com/json/" . urlencode($ip) . "?fields=status,country,city";
    $ctx = stream_context_create(['http' => ['timeout' => 1.5, 'ignore_errors' => true]]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) return $empty;

    $data = json_decode($raw, true);
    if (!is_array($data) || ($data['status'] ?? '') !== 'success') return $empty;
    return [
        'country' => (string)($data['country'] ?? ''),
        'city'    => (string)($data['city'] ?? ''),
    ];
}
