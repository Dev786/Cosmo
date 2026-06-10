<?php
/** Verify a Razorpay browser callback server-side, then release the repo URL. Razorpay
 *  only — PayPal confirms via capture + webhook. The webhook is the backstop if this
 *  call never arrives (tab closed). */
require_once __DIR__ . '/../includes/api.php';
require_once __DIR__ . '/../includes/processors/registry.php';

require_post();
require_same_origin();
rate_limit('verify', 30, 600);

$cfg = api_config();
$in        = json_input();
$orderId   = (string)($in['razorpay_order_id'] ?? '');
$paymentId = (string)($in['razorpay_payment_id'] ?? '');
$signature = (string)($in['razorpay_signature'] ?? '');
$email     = strtolower(trim((string)($in['email'] ?? '')));

if ($orderId === '' || $paymentId === '' || $signature === '') {
    json_out(['error' => 'Missing payment fields.'], 422);
}

$rzp = processor_get('razorpay');
if (!$rzp->verifyClientSignature($orderId, $paymentId, $signature)) {
    try {
        db()->prepare('UPDATE donations SET status = "failed", razorpay_payment_id = :pid
                       WHERE razorpay_order_id = :oid AND status = "created"')
            ->execute([':pid' => $paymentId, ':oid' => $orderId]);
    } catch (Throwable $e) {}
    json_out(['error' => 'Payment could not be verified.'], 400);
}

// Verified — complete the donation (idempotent: don't override a webhook that already paid it).
try {
    db()->prepare(
        'UPDATE donations SET status = "paid", razorpay_payment_id = :pid,
         email = COALESCE(NULLIF(:email, ""), email)
         WHERE razorpay_order_id = :oid AND status IN ("created","failed")'
    )->execute([':pid' => $paymentId, ':email' => $email, ':oid' => $orderId]);
} catch (Throwable $e) { /* payment still valid even if the row update hiccups */ }

json_out(['ok' => true, 'repo_url' => (string)$cfg['repo_url']]);
