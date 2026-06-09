<?php
/** Verify a Razorpay payment SERVER-SIDE before trusting it. The signature is an
 *  HMAC-SHA256 of "order_id|payment_id" keyed by the secret — only the server can
 *  compute it, so a forged client callback can't unlock anything. On success we
 *  mark the donation paid and release the repo URL. */
require_once __DIR__ . '/../includes/api.php';
require_post();
$cfg = api_config();
$rzp = $cfg['razorpay'];

$in        = json_input();
$orderId   = (string)($in['razorpay_order_id'] ?? '');
$paymentId = (string)($in['razorpay_payment_id'] ?? '');
$signature = (string)($in['razorpay_signature'] ?? '');
$email     = strtolower(trim((string)($in['email'] ?? '')));

if ($orderId === '' || $paymentId === '' || $signature === '') {
    json_out(['error' => 'Missing payment fields.'], 422);
}
if (empty($rzp['key_secret'])) json_out(['error' => 'Payments not configured.'], 503);

$expected = hash_hmac('sha256', $orderId . '|' . $paymentId, $rzp['key_secret']);
if (!hash_equals($expected, $signature)) {
    // Mark the attempt failed (best-effort) and reject.
    try {
        db()->prepare('UPDATE donations SET status = "failed", razorpay_payment_id = :pid WHERE razorpay_order_id = :oid')
            ->execute([':pid' => $paymentId, ':oid' => $orderId]);
    } catch (Throwable $e) {}
    json_out(['error' => 'Payment could not be verified.'], 400);
}

// Verified — complete the donation.
try {
    db()->prepare(
        'UPDATE donations SET status = "paid", razorpay_payment_id = :pid, email = COALESCE(NULLIF(:email, ""), email)
         WHERE razorpay_order_id = :oid'
    )->execute([':pid' => $paymentId, ':email' => $email, ':oid' => $orderId]);
} catch (Throwable $e) { /* payment is still valid even if the row update hiccups */ }

// A verified tip always releases the URL (even if the gate is on).
json_out(['ok' => true, 'repo_url' => (string)$cfg['repo_url']]);
