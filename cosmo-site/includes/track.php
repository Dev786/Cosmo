<?php
/** Pageview logger. Included near the top of every public page. ENTIRELY
 *  best-effort: any failure (no config, DB down, geo slow) is swallowed so the
 *  page always renders. Respects a 'no-track' cookie set by the consent notice. */

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/geo.php';

(function (): void {
    try {
        if (cosmo_config() === null) return;                  // not set up yet
        if (($_COOKIE['cosmo_notrack'] ?? '') === '1') return; // user opted out
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') return;

        $ip  = client_ip();
        $geo = geo_lookup($ip);

        $stmt = db()->prepare(
            'INSERT INTO visits (created_at, ip, country, city, referrer, path, user_agent)
             VALUES (NOW(), :ip, :country, :city, :referrer, :path, :ua)'
        );
        $stmt->execute([
            ':ip'       => $ip,
            ':country'  => $geo['country'],
            ':city'     => $geo['city'],
            ':referrer' => substr((string)($_SERVER['HTTP_REFERER'] ?? ''), 0, 512),
            ':path'     => substr((string)($_SERVER['REQUEST_URI'] ?? ''), 0, 255),
            ':ua'       => substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 512),
        ]);
    } catch (Throwable $e) {
        // swallow — tracking must never break the page
    }
})();
