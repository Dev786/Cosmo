<?php
/** Razorpay webhook — the authoritative, retried, server-to-server confirmation of a
 *  payment. It's the backstop for when the browser never returns to verify_payment.php
 *  (e.g. the user closed the tab right after paying): Razorpay still tells us here.
 *
 *  Security: verify the HMAC-SHA256 signature of the RAW request body (keyed by the
 *  webhook secret you set in the Razorpay dashboard) BEFORE parsing anything. A request
 *  that doesn't carry a valid signature is rejected with 400 and never trusted.
 *
 *  Idempotent: Razorpay retries until it gets a 2xx, so duplicate deliveries are
 *  expected. We only ever flip a row created/failed -> paid, so re-deliveries are no-ops.
 *  Config: set RAZORPAY_WEBHOOK_SECRET in .env to the same secret entered in the
 *  dashboard webhook. Matches the donations row by razorpay_order_id. */

require_once __DIR__ . '/../includes/db.php';

$raw = file_get_contents('php://input') ?: '';
$sig = (string)($_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? '');
$cfg = cosmo_config();
$secret = (string)($cfg['razorpay']['webhook_secret'] ?? '');

// Verify the raw body's signature first — never parse an unauthenticated payload.
if ($secret === '' || $sig === '' || !hash_equals(hash_hmac('sha256', $raw, $secret), $sig)) {
    http_response_code(400);
    echo 'bad signature';
    exit;
}

$event     = json_decode($raw, true) ?: [];
$type      = (string)($event['event'] ?? '');
$entity    = $event['payload']['payment']['entity'] ?? null;
$orderId   = (string)($entity['order_id'] ?? '');
$paymentId = (string)($entity['id'] ?? '');

if ($orderId !== '') {
    try {
        if ($type === 'payment.captured' || $type === 'order.paid') {
            // Idempotent: only created/failed -> paid (a re-delivered event is a no-op).
            db()->prepare(
                'UPDATE donations SET status = "paid", razorpay_payment_id = :pid
                 WHERE razorpay_order_id = :oid AND status IN ("created", "failed")'
            )->execute([':pid' => $paymentId, ':oid' => $orderId]);
        } elseif ($type === 'payment.failed') {
            db()->prepare(
                'UPDATE donations SET status = "failed", razorpay_payment_id = :pid
                 WHERE razorpay_order_id = :oid AND status = "created"'
            )->execute([':pid' => $paymentId, ':oid' => $orderId]);
        }
    } catch (Throwable $ex) {
        // Non-fatal: still return 200 so Razorpay doesn't hammer retries over a transient DB blip.
    }
}

http_response_code(200);
echo 'ok';
