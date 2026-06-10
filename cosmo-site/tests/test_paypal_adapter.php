<?php
require_once __DIR__ . '/../includes/processors/types.php';
require_once __DIR__ . '/../includes/processors/paypal.php';

$pp = new PayPalProcessor(['client_id' => 'cid', 'secret' => 'sec', 'webhook_id' => 'wh', 'env' => 'sandbox']);

section('PayPalProcessor identity + base url');
eq('id', $pp->id(), 'paypal');
eq('sandbox base', PayPalProcessor::baseFor('sandbox'), 'https://api-m.sandbox.paypal.com');
eq('live base', PayPalProcessor::baseFor('live'), 'https://api-m.paypal.com');

section('minor → PayPal decimal string (major units)');
eq('300 → 3.00', PayPalProcessor::minorToValue(300), '3.00');
eq('500 → 5.00', PayPalProcessor::minorToValue(500), '5.00');
eq('2599 → 25.99', PayPalProcessor::minorToValue(2599), '25.99');

section('parseWebhookEvent (CAPTURE.COMPLETED → paid)');
$ev = ['event_type' => 'PAYMENT.CAPTURE.COMPLETED', 'resource' => [
    'id' => 'cap_1',
    'amount' => ['currency_code' => 'USD', 'value' => '5.00'],
    'supplementary_data' => ['related_ids' => ['order_id' => 'ord_1']],
]];
$p = $pp->parseWebhookEvent($ev);
eq('→ paid', $p['status'], 'paid');
eq('order id from related_ids', $p['order_id'], 'ord_1');
eq('payment/capture id', $p['payment_id'], 'cap_1');
eq('amount minor from value', $p['amount_minor'], 500);
eq('currency', $p['currency'], 'USD');

$denied = ['event_type' => 'PAYMENT.CAPTURE.DENIED', 'resource' => [
    'id' => 'c',
    'amount' => ['currency_code' => 'USD', 'value' => '5.00'],
    'supplementary_data' => ['related_ids' => ['order_id' => 'o']],
]];
eq('denied → failed', $pp->parseWebhookEvent($denied)['status'], 'failed');
check('unrelated event → null', $pp->parseWebhookEvent(['event_type' => 'BILLING.SUBSCRIPTION.CREATED']) === null);
