<?php
/** Email gate. Stores the lead (dedup by email) with best-effort geo, then tells
 *  the client whether the repo URL is released now or gated behind a tip. */
require_once __DIR__ . '/../includes/api.php';
require_once __DIR__ . '/../includes/geo.php';
require_post();
$cfg = api_config();

$in      = json_input();
$email   = strtolower(trim((string)($in['email'] ?? '')));
$consent = !empty($in['consent']) ? 1 : 0;

if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) {
    json_out(['error' => 'Please enter a valid email.'], 422);
}

try {
    $ip  = client_ip();
    $geo = geo_lookup($ip);
    $stmt = db()->prepare(
        'INSERT INTO leads (email, created_at, ip, country, city, referrer, consent)
         VALUES (:email, NOW(), :ip, :country, :city, :ref, :consent)
         ON DUPLICATE KEY UPDATE consent = GREATEST(consent, VALUES(consent))'
    );
    $stmt->execute([
        ':email'   => $email,
        ':ip'      => $ip,
        ':country' => $geo['country'],
        ':city'    => $geo['city'],
        ':ref'     => substr((string)($_SERVER['HTTP_REFERER'] ?? ''), 0, 512),
        ':consent' => $consent,
    ]);
} catch (Throwable $e) {
    json_out(['error' => 'Could not save your email right now. Please try again.'], 500);
}

$gate = (bool)$cfg['require_payment_for_url'];
json_out([
    'ok'              => true,
    'require_payment' => $gate,
    // Released only when not gated. May be '' until the repo goes public — the
    // client then shows "you're on the list".
    'repo_url'        => $gate ? '' : (string)$cfg['repo_url'],
]);
