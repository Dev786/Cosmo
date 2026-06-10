<?php
/** Secrets + config. Everything sensitive lives in `.env` (never in any .php/.html
 *  and .htaccess-denied); this loads it. Pages call cosmo_config()/db() only when
 *  they need data, and all of it is safe to call before `.env` exists — the
 *  marketing pages still render on a fresh box. */

/** Read a value from `.env` (parsed once), falling back to a real environment
 *  variable, then to $default. Strips surrounding quotes and ignores #-comments. */
function env(string $key, ?string $default = null): ?string
{
    static $vars = null;
    if ($vars === null) {
        $vars = [];
        $path = __DIR__ . '/../.env';
        if (is_file($path)) {
            foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
                $line = trim($line);
                if ($line === '' || $line[0] === '#') continue;
                $pos = strpos($line, '=');
                if ($pos === false) continue;
                $k = trim(substr($line, 0, $pos));
                $v = trim(substr($line, $pos + 1));
                if (strlen($v) >= 2 && ($v[0] === '"' || $v[0] === "'") && $v[strlen($v) - 1] === $v[0]) {
                    $v = substr($v, 1, -1);
                }
                $vars[$k] = $v;
            }
        }
    }
    // Real environment variables WIN over the .env file (12-factor). On Hostinger
    // none of these are set so .env is used; in Docker the container can point PHP
    // at the local MySQL by exporting DB_* without touching the user's .env.
    $envv = getenv($key);
    $val = ($envv !== false && $envv !== '') ? $envv : ($vars[$key] ?? null);
    return ($val === null || $val === '') ? $default : $val;
}

/** Cache-busting suffix for a local CSS/JS asset, keyed on its file mtime so a
 *  browser refetches the instant the file changes — and keeps the cached copy
 *  until then. Returns e.g. "?v=1718045123", or "" if the file can't be found.
 *  Pass the docroot-relative path; admin pages keep the "../" in their href and
 *  we stat by stripping any leading "./" or "../". */
function asset_v(string $relPath): string
{
    static $root = null;
    if ($root === null) $root = dirname(__DIR__); // cosmo-site/ docroot
    $m = @filemtime($root . '/' . ltrim($relPath, './'));
    return $m ? '?v=' . $m : '';
}

/** Assembled config, sourced entirely from `.env`. Returns null when `.env` is
 *  absent so public pages still render before the box is configured. */
function cosmo_config(): ?array
{
    static $cfg = null;
    static $loaded = false;
    if (!$loaded) {
        $loaded = true;
        if (!is_file(__DIR__ . '/../.env')) return $cfg; // not set up yet
        $cfg = [
            'db' => [
                'host'    => env('DB_HOST', 'localhost'),
                'name'    => env('DB_NAME', ''),
                'user'    => env('DB_USER', ''),
                'pass'    => env('DB_PASS', ''),
                'charset' => 'utf8mb4',
            ],
            'razorpay' => [
                'key_id'         => env('RAZORPAY_KEY_ID', ''),
                'key_secret'     => env('RAZORPAY_KEY_SECRET', ''),
                'webhook_secret' => env('RAZORPAY_WEBHOOK_SECRET', ''),
                'currency'       => env('RAZORPAY_CURRENCY', 'INR'),
                'preset_amounts' => array_values(array_filter(array_map(
                    'intval',
                    explode(',', (string)env('RAZORPAY_PRESETS', '99,199,499'))
                ))),
            ],
            'repo_url'                => (string)env('REPO_URL', ''),
            'require_payment_for_url' => filter_var(env('REQUIRE_PAYMENT_FOR_URL', 'false'), FILTER_VALIDATE_BOOLEAN),
            'admin_password_hash'     => (string)env('ADMIN_PASSWORD_HASH', ''),
            'site_url'                => (string)env('SITE_URL', ''),
            'site_name'               => 'Cosmo',
            'geo_enabled'             => filter_var(env('GEO_ENABLED', 'true'), FILTER_VALIDATE_BOOLEAN),
        ];
    }
    return $cfg;
}

/** Single shared PDO. Throws if `.env`/DB is unreachable — callers that need the
 *  DB let it surface; best-effort callers (track.php) wrap it in try/catch. */
function db(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $cfg = cosmo_config();
        if ($cfg === null) {
            throw new RuntimeException('.env missing — copy .env.example to .env and fill it in.');
        }
        $c = $cfg['db'];
        $dsn = "mysql:host={$c['host']};dbname={$c['name']};charset={$c['charset']}";
        $pdo = new PDO($dsn, $c['user'], $c['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
            PDO::ATTR_TIMEOUT            => 4,   // fail fast if the DB is unreachable — never hang a page
        ]);
    }
    return $pdo;
}

/** Best-effort client IP (honours a forwarded header if present). */
function client_ip(): string
{
    foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'] as $k) {
        if (!empty($_SERVER[$k])) {
            $ip = trim(explode(',', $_SERVER[$k])[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP)) return $ip;
        }
    }
    return '';
}

/** HTML-escape for output. Used wherever admin echoes stored (attacker-controlled) data. */
function e(?string $s): string
{
    return htmlspecialchars($s ?? '', ENT_QUOTES, 'UTF-8');
}
