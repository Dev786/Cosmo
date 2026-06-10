<?php
require_once __DIR__ . '/../includes/processors/types.php';
require_once __DIR__ . '/../includes/processors/razorpay.php';

$rzp = new RazorpayProcessor(['key_id' => 'rzp_test_x', 'key_secret' => 'secret123', 'webhook_secret' => 'whsec']);

section('RazorpayProcessor identity');
eq('id', $rzp->id(), 'razorpay');

section('client-callback signature (HMAC order_id|payment_id)');
$order = 'order_ABC'; $pay = 'pay_XYZ';
$goodSig = hash_hmac('sha256', $order . '|' . $pay, 'secret123');
check('valid signature accepted', $rzp->verifyClientSignature($order, $pay, $goodSig));
check('tampered signature rejected', !$rzp->verifyClientSignature($order, $pay, $goodSig . 'x'));
check('wrong payment id rejected', !$rzp->verifyClientSignature($order, 'pay_OTHER', $goodSig));

section('webhook signature (HMAC of raw body, whsec)');
$body = '{"event":"payment.captured"}';
$sig  = hash_hmac('sha256', $body, 'whsec');
check('valid webhook sig', $rzp->verifyWebhook($body, ['x-razorpay-signature' => $sig]));
check('bad webhook sig', !$rzp->verifyWebhook($body, ['x-razorpay-signature' => 'nope']));

section('parseWebhookEvent');
$captured = ['event' => 'payment.captured', 'payload' => ['payment' => ['entity' => [
    'id' => 'pay_1', 'order_id' => 'order_1', 'amount' => 4900, 'currency' => 'INR']]]];
$p = $rzp->parseWebhookEvent($captured);
eq('captured → paid', $p['status'], 'paid');
eq('order id', $p['order_id'], 'order_1');
eq('payment id', $p['payment_id'], 'pay_1');
eq('amount minor', $p['amount_minor'], 4900);
eq('currency', $p['currency'], 'INR');
$failed = ['event' => 'payment.failed', 'payload' => ['payment' => ['entity' => [
    'id' => 'pay_2', 'order_id' => 'order_2', 'amount' => 4900, 'currency' => 'INR']]]];
eq('failed → failed', $rzp->parseWebhookEvent($failed)['status'], 'failed');
check('irrelevant event → null', $rzp->parseWebhookEvent(['event' => 'refund.created']) === null);
