<?php
/** Shared bootstrap for /api endpoints: JSON in/out helpers + method guard. */
require_once __DIR__ . '/db.php';
header('Content-Type: application/json; charset=utf-8');

function json_input(): array
{
    $d = json_decode((string)file_get_contents('php://input'), true);
    return is_array($d) ? $d : [];
}

function json_out($data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function require_post(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') json_out(['error' => 'POST only'], 405);
}

/** Config or a clean 500 — endpoints need a configured box. */
function api_config(): array
{
    $cfg = cosmo_config();
    if ($cfg === null) json_out(['error' => 'Site not configured yet.'], 503);
    return $cfg;
}

/** Build a lowercased header map from $_SERVER (works on Apache/nginx/CLI; no getallheaders dependency). */
function request_headers_lower(): array
{
    $h = [];
    foreach ($_SERVER as $k => $v) {
        if (str_starts_with($k, 'HTTP_')) {
            $name = strtolower(str_replace('_', '-', substr($k, 5)));
            $h[$name] = $v;
        }
    }
    return $h;
}

/** Salted SHA-256 of an IP — we never store raw IPs. Salt from .env (IP_SALT).
 *  (client_ip() itself lives in db.php and already honours CF/X-Forwarded-For.) */
function ip_hash(string $ip): string
{
    return hash('sha256', $ip . '|' . (string)env('IP_SALT', 'cosmo-default-salt'));
}

/** Lowercase a host and drop a leading "www." so apex and www count as the same site.
 *  (iamcosmo.in and www.iamcosmo.in both serve the site, so a visitor on either must pass.) */
function normalize_host(?string $host): string
{
    $host = strtolower((string)$host);
    return ($host !== '' && str_starts_with($host, 'www.')) ? substr($host, 4) : $host;
}

/** Pure: does the request Origin/Referer host equal the site host (www-insensitive)?
 *  Empty origin or empty site = allow (no header on some browsers / dev box). */
function origin_host_matches(string $origin, string $siteUrl): bool
{
    if ($origin === '' || $siteUrl === '') return true;
    $oh = normalize_host(parse_url($origin, PHP_URL_HOST));
    $sh = normalize_host(parse_url($siteUrl, PHP_URL_HOST));
    return $oh !== '' && $sh !== '' && $oh === $sh;
}

/** 403 unless the request's Origin (or Referer) host matches the configured site_url host. */
function require_same_origin(): void
{
    $cfg = cosmo_config();
    $site = (string)($cfg['site_url'] ?? '');
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '');
    if (!origin_host_matches($origin, $site)) json_out(['error' => 'Bad origin.'], 403);
}

/** Pure: fixed-window bucket start (unix seconds) for a timestamp + window length. */
function rate_window_start(int $now, int $windowSec): int
{
    return $now - ($now % $windowSec);
}

/** Per-IP fixed-window limiter. Over `cap` hits in `windowSec` → 429. Fail-open on DB errors
 *  (never block a paying user because a logging table hiccuped). */
function rate_limit(string $action, int $cap, int $windowSec): void
{
    try {
        $bucket = gmdate('Y-m-d H:i:s', rate_window_start(time(), $windowSec));
        $h = ip_hash(client_ip());
        $pdo = db();
        $pdo->prepare(
            'INSERT INTO rate_limits (ip_hash, action, window_start, hits) VALUES (:h, :a, :w, 1)
             ON DUPLICATE KEY UPDATE hits = hits + 1'
        )->execute([':h' => $h, ':a' => $action, ':w' => $bucket]);
        $hits = (int)$pdo->query(
            'SELECT hits FROM rate_limits WHERE ip_hash = ' . $pdo->quote($h) .
            ' AND action = ' . $pdo->quote($action) . ' AND window_start = ' . $pdo->quote($bucket)
        )->fetchColumn();
        // Opportunistic cleanup (~1 in 20 calls) to keep the table small.
        if (($hits % 20) === 0) {
            $pdo->exec("DELETE FROM rate_limits WHERE window_start < (UTC_TIMESTAMP() - INTERVAL 1 DAY)");
        }
        if ($hits > $cap) json_out(['error' => 'Too many requests — slow down a moment.'], 429);
    } catch (Throwable $e) { /* fail-open */ }
}
