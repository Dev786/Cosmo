<?php
require_once __DIR__ . '/../includes/admin_stats.php';

section('currency_symbol');
eq('INR', currency_symbol('INR'), '₹');
eq('USD', currency_symbol('USD'), '$');
eq('EUR', currency_symbol('EUR'), '€');
eq('GBP', currency_symbol('GBP'), '£');
eq('lowercase usd', currency_symbol('usd'), '$');

section('money_fmt (minor units in → symbol + major out)');
eq('4900 INR → ₹49', money_fmt(4900, 'INR'), '₹49');
eq('300 USD → $3.00', money_fmt(300, 'USD'), '$3.00');
eq('2599 USD → $25.99', money_fmt(2599, 'USD'), '$25.99');
eq('0 EUR → €0.00', money_fmt(0, 'EUR'), '€0.00');
eq('empty currency → INR', money_fmt(4900, ''), '₹49');
eq('unknown JPY → code prefix', money_fmt(500, 'JPY'), 'JPY 5.00');

section('event_who / event_detail (pure row formatting)');
$tip   = ['kind' => 'tip', 'email' => 'a@b.com', 'country' => '', 'path' => '', 'ip' => '', 'amount_paise' => 300, 'currency' => 'USD', 'status' => 'paid'];
$lead  = ['kind' => 'lead', 'email' => 'c@d.com', 'country' => 'India', 'path' => '', 'ip' => '', 'amount_paise' => null, 'currency' => '', 'status' => 'subscribed'];
$visit = ['kind' => 'visit', 'email' => '', 'country' => 'India', 'path' => '/support.php', 'ip' => '1.2.3.4', 'amount_paise' => null, 'currency' => '', 'status' => ''];
eq('tip who = email', event_who($tip), 'a@b.com');
eq('visit who = country (no email)', event_who($visit), 'India');
eq('tip detail = amount · status', event_detail($tip), '$3.00 · paid');
eq('lead detail = subscribed', event_detail($lead), 'subscribed to updates');
check('visit detail includes path', str_contains(event_detail($visit), '/support.php'));
check('visit detail includes country', str_contains(event_detail($visit), 'India'));
