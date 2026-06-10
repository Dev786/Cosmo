<?php
/** Create a payment order with the processor that serves the visitor's currency:
 *  INR→Razorpay, foreign→FOREIGN_PROCESSOR (PayPal). Currency is decided server-side
 *  (override∈enabled → geo → default) and the floor is enforced here. */
require_once __DIR__ . '/../includes/api.php';
require_once __DIR__ . '/../includes/geo.php';
require_once __DIR__ . '/../includes/currency.php';
require_once __DIR__ . '/../includes/processors/registry.php';

require_post();
require_same_origin();
rate_limit('order', 12, 600);

$cfg = api_config();
$pay = $cfg['payments'] ?? ['enabled_currencies' => ['INR'], 'default_currency' => 'INR', 'foreign_processor' => 'paypal'];

$in       = json_input();
$email    = strtolower(trim((string)($in['email'] ?? '')));
$amount   = (int)($in['amount'] ?? 0);
$override = isset($in['currency']) ? (string)$in['currency'] : null;

$geoIso = geo_lookup(client_ip())['countryCode'] ?? '';
$cur    = resolve_currency($override, $geoIso, $pay['enabled_currencies'], (string)$pay['default_currency']);
$meta   = currency_meta($cur);

if ($amount < $meta['floor'] || $amount > $meta['max']) {
    json_out(['error' => "Pick at least {$meta['symbol']}{$meta['floor']}."], 422);
}

$procId  = processor_for_currency($cur, (string)$pay['foreign_processor']);
$minor   = to_minor($amount, $cur);
$receipt = 'cosmo_' . bin2hex(random_bytes(6));   // ≤40 chars, unique → also the provider idempotency key

try {
    $proc  = processor_get($procId);
    $order = $proc->createOrder($minor, $cur, $email, $receipt);
} catch (Throwable $e) {
    json_out(['error' => 'Could not start the payment. Please try again.'], 502);
}

// Record the pending order so the webhook / verify can complete it.
try {
    db()->prepare(
        'INSERT INTO donations (created_at, email, amount_paise, currency, country, ip_hash, processor, razorpay_order_id, status)
         VALUES (NOW(), :email, :amt, :cur, :country, :iph, :proc, :oid, "created")'
    )->execute([
        ':email' => $email, ':amt' => $minor, ':cur' => $cur, ':country' => substr($geoIso, 0, 2),
        ':iph' => ip_hash(client_ip()), ':proc' => $procId, ':oid' => $order['order_id'],
    ]);
} catch (Throwable $e) { /* non-fatal: payment can still proceed (e.g. before the migration runs) */ }

json_out(['ok' => true, 'provider' => $procId, 'currency' => $cur] + $order['client']);
