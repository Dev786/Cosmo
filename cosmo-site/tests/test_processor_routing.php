<?php
require_once __DIR__ . '/../includes/currency.php';

section('end-to-end resolution → processor');
$enabled = ['INR', 'USD', 'EUR', 'GBP'];
$indiaCur = resolve_currency(null, 'IN', $enabled, 'USD');
eq('India → INR', $indiaCur, 'INR');
eq('India → razorpay', processor_for_currency($indiaCur, 'paypal'), 'razorpay');
$usCur = resolve_currency(null, 'US', $enabled, 'USD');
eq('US → USD', $usCur, 'USD');
eq('US → paypal', processor_for_currency($usCur, 'paypal'), 'paypal');
eq('US floor 3 → 300 minor', to_minor(currency_meta($usCur)['floor'], $usCur), 300);

section('floor enforcement boundary');
$m = currency_meta('USD');
check('2 below floor', 2 < $m['floor']);
check('3 meets floor', 3 >= $m['floor']);
