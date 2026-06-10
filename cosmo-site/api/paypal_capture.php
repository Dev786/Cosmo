<?php
/** PayPal onApprove → capture the order SERVER-SIDE (never trust the client), mark the
 *  donation paid, release the repo URL. The PAYMENT.CAPTURE.COMPLETED webhook is the backstop. */
require_once __DIR__ . '/../includes/api.php';
require_once __DIR__ . '/../includes/processors/registry.php';

require_post();
require_same_origin();
rate_limit('capture', 30, 600);

$cfg = api_config();
$in      = json_input();
$orderId = (string)($in['order_id'] ?? '');
$email   = strtolower(trim((string)($in['email'] ?? '')));
if ($orderId === '') json_out(['error' => 'Missing order id.'], 422);

try {
    $pp  = processor_get('paypal');
    $res = $pp->captureOrder($orderId);
} catch (Throwable $e) {
    json_out(['error' => 'Could not complete the payment.'], 502);
}

if (($res['status'] ?? '') !== 'paid') {
    try {
        db()->prepare('UPDATE donations SET status = "failed" WHERE razorpay_order_id = :oid AND status = "created"')
            ->execute([':oid' => $orderId]);
    } catch (Throwable $e) {}
    json_out(['error' => 'Payment was not completed.'], 400);
}

// Cross-check the captured amount/currency against the stored row before trusting it.
try {
    $row = db()->prepare('SELECT amount_paise, currency FROM donations WHERE razorpay_order_id = :oid');
    $row->execute([':oid' => $orderId]);
    $stored = $row->fetch();
    if ($stored && ((int)$stored['amount_paise'] !== (int)$res['amount_minor']
        || strcasecmp((string)$stored['currency'], (string)$res['currency']) !== 0)) {
        // Amount/currency mismatch — refuse to unlock; log by marking failed.
        db()->prepare('UPDATE donations SET status = "failed" WHERE razorpay_order_id = :oid')->execute([':oid' => $orderId]);
        json_out(['error' => 'Payment validation failed.'], 400);
    }
    db()->prepare(
        'UPDATE donations SET status = "paid", razorpay_payment_id = :pid,
         email = COALESCE(NULLIF(:email, ""), email)
         WHERE razorpay_order_id = :oid AND status IN ("created","failed")'
    )->execute([':pid' => (string)($res['payment_id'] ?? ''), ':email' => $email, ':oid' => $orderId]);
} catch (Throwable $e) { /* capture already succeeded with PayPal; URL still released below */ }

json_out(['ok' => true, 'repo_url' => (string)$cfg['repo_url']]);
