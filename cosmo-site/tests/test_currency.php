<?php
require_once __DIR__ . '/../includes/currency.php';

section('currency_for_country');
eq('IN→INR', currency_for_country('IN'), 'INR');
eq('US→USD', currency_for_country('US'), 'USD');
eq('GB→GBP', currency_for_country('GB'), 'GBP');
eq('DE→EUR', currency_for_country('DE'), 'EUR');
eq('FR→EUR', currency_for_country('FR'), 'EUR');
eq('unknown→USD (default)', currency_for_country('ZZ'), 'USD');
eq('empty→USD (default)', currency_for_country(''), 'USD');
eq('lowercase in→INR', currency_for_country('in'), 'INR');

section('resolve_currency (override → geo → default)');
$enabled = ['INR', 'USD', 'EUR', 'GBP'];
eq('valid override wins', resolve_currency('EUR', 'IN', $enabled, 'USD'), 'EUR');
eq('disabled override ignored → geo', resolve_currency('JPY', 'IN', $enabled, 'USD'), 'INR');
eq('no override → geo', resolve_currency(null, 'GB', $enabled, 'USD'), 'GBP');
eq('no override, unknown geo → default', resolve_currency(null, 'ZZ', $enabled, 'USD'), 'USD');
eq('geo currency not enabled → default', resolve_currency(null, 'GB', ['INR', 'USD'], 'USD'), 'USD');

section('currency_meta + to_minor');
eq('INR floor', currency_meta('INR')['floor'], 49);
eq('USD floor (raised to 3)', currency_meta('USD')['floor'], 3);
eq('EUR floor', currency_meta('EUR')['floor'], 3);
eq('GBP floor', currency_meta('GBP')['floor'], 3);
eq('INR presets', currency_meta('INR')['presets'], [49, 99, 199, 499]);
eq('USD presets', currency_meta('USD')['presets'], [3, 5, 10, 25]);
eq('to_minor 49 INR', to_minor(49, 'INR'), 4900);
eq('to_minor 3 USD', to_minor(3, 'USD'), 300);
eq('unknown currency meta falls back to default', currency_meta('JPY')['floor'], currency_meta('USD')['floor']);

section('processor_for_currency (swappable foreign)');
eq('INR always razorpay', processor_for_currency('INR', 'paypal'), 'razorpay');
eq('USD → foreign (paypal)', processor_for_currency('USD', 'paypal'), 'paypal');
eq('EUR → foreign flips to razorpay', processor_for_currency('EUR', 'razorpay'), 'razorpay');

section('public_currency_map');
$pub = public_currency_map(['INR', 'USD']);
eq('only enabled keys', array_keys($pub), ['INR', 'USD']);
eq('has symbol/floor/presets', isset($pub['USD']['symbol'], $pub['USD']['floor'], $pub['USD']['presets']), true);
check('public map omits max/minor (internal)', !isset($pub['USD']['max']));
