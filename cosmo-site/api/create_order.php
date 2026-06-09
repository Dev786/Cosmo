<?php
/** Create a Razorpay order (server-side, with the secret key) and record it as a
 *  pending donation. Returns what Razorpay Checkout needs in the browser. */
require_once __DIR__ . '/../includes/api.php';
require_post();
$cfg = api_config();
$rzp = $cfg['razorpay'];

if (empty($rzp['key_id']) || empty($rzp['key_secret']) || stripos($rzp['key_id'], 'REPLACE') !== false) {
    json_out(['error' => 'Tipping is not configured yet.'], 503);
}

$in     = json_input();
$rupees = (int)($in['amount'] ?? 0);
$email  = strtolower(trim((string)($in['email'] ?? '')));
if ($rupees < 1 || $rupees > 100000) json_out(['error' => 'Pick an amount between ₹1 and ₹1,00,000.'], 422);
$paise = $rupees * 100;

$payload = json_encode([
    'amount'   => $paise,
    'currency' => $rzp['currency'],
    'receipt'  => 'cosmo_' . bin2hex(random_bytes(6)),
    'notes'    => ['email' => $email, 'product' => 'Cosmo coffee'],
]);

$ch = curl_init('https://api.razorpay.com/v1/orders');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_USERPWD        => $rzp['key_id'] . ':' . $rzp['key_secret'],
    CURLOPT_POST           => true,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_TIMEOUT        => 15,
]);
$resp = curl_exec($ch);
$http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$order = json_decode((string)$resp, true);
if ($resp === false || $http >= 400 || empty($order['id'])) {
    json_out(['error' => 'Could not start the payment. Please try again.'], 502);
}

// Record the pending order so verify_payment can confirm + complete it.
try {
    $stmt = db()->prepare(
        'INSERT INTO donations (created_at, email, amount_paise, currency, razorpay_order_id, status)
         VALUES (NOW(), :email, :amt, :cur, :oid, "created")'
    );
    $stmt->execute([':email' => $email, ':amt' => $paise, ':cur' => $rzp['currency'], ':oid' => $order['id']]);
} catch (Throwable $e) { /* non-fatal: payment can still proceed */ }

json_out([
    'ok'       => true,
    'order_id' => $order['id'],
    'key_id'   => $rzp['key_id'],
    'amount'   => $paise,
    'currency' => $rzp['currency'],
]);
