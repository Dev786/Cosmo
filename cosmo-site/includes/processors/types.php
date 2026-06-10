<?php
/** Contract every payment processor implements. createOrder + webhook are common;
 *  client-callback verification (Razorpay) and server capture (PayPal) are added as
 *  extra public methods on the concrete adapters that need them. */
interface PaymentProcessor
{
    public function id(): string;                  // 'razorpay' | 'paypal'

    /** Create a provider order. $minor = smallest-unit amount, $cur = ISO code.
     *  Returns ['order_id' => string, 'client' => array] (browser launch fields).
     *  Throws RuntimeException on failure. */
    public function createOrder(int $minor, string $cur, string $email, string $receipt): array;

    /** Is this incoming webhook genuine? $headers = lowercased header map. */
    public function verifyWebhook(string $rawBody, array $headers): bool;

    /** Normalize a verified webhook payload to a common shape, or null if not relevant.
     *  ['status'=>'paid'|'failed', 'order_id'=>string, 'payment_id'=>?string,
     *   'amount_minor'=>?int, 'currency'=>?string] */
    public function parseWebhookEvent(array $event): ?array;
}
