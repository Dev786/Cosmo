<?php
require_once __DIR__ . '/types.php';
require_once __DIR__ . '/razorpay.php';
require_once __DIR__ . '/paypal.php';

/** Return the processor adapter for an id, configured from cosmo_config(). */
function processor_get(string $id): PaymentProcessor
{
    $cfg = cosmo_config() ?? [];
    return match ($id) {
        'razorpay' => new RazorpayProcessor($cfg['razorpay'] ?? []),
        'paypal'   => new PayPalProcessor($cfg['paypal'] ?? []),
        default    => throw new RuntimeException("Unknown processor: $id"),
    };
}
