<?php
require_once __DIR__ . '/types.php';

/** Razorpay Orders API + client-callback + webhook. amount is in minor units (paise). */
final class RazorpayProcessor implements PaymentProcessor
{
    public function __construct(private array $cfg) {}

    public function id(): string { return 'razorpay'; }

    public function createOrder(int $minor, string $cur, string $email, string $receipt): array
    {
        $keyId = (string)($this->cfg['key_id'] ?? '');
        $secret = (string)($this->cfg['key_secret'] ?? '');
        if ($keyId === '' || $secret === '' || stripos($keyId, 'REPLACE') !== false) {
            throw new RuntimeException('Razorpay is not configured.');
        }
        $payload = json_encode([
            'amount'   => $minor,
            'currency' => $cur,
            'receipt'  => $receipt,
            'notes'    => ['email' => $email, 'product' => 'Cosmo coffee'],
        ]);
        $ch = curl_init('https://api.razorpay.com/v1/orders');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERPWD        => $keyId . ':' . $secret,
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_TIMEOUT        => 15,
        ]);
        $resp = curl_exec($ch);
        $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $order = json_decode((string)$resp, true);
        if ($resp === false || $http >= 400 || empty($order['id'])) {
            throw new RuntimeException('Razorpay order create failed.');
        }
        return [
            'order_id' => $order['id'],
            'client'   => ['provider' => 'razorpay', 'key_id' => $keyId,
                           'order_id' => $order['id'], 'amount' => $minor, 'currency' => $cur],
        ];
    }

    /** Browser handler signature: HMAC-SHA256(order_id|payment_id, key_secret). */
    public function verifyClientSignature(string $orderId, string $paymentId, string $signature): bool
    {
        $secret = (string)($this->cfg['key_secret'] ?? '');
        if ($secret === '') return false;
        $expected = hash_hmac('sha256', $orderId . '|' . $paymentId, $secret);
        return hash_equals($expected, $signature);
    }

    public function verifyWebhook(string $rawBody, array $headers): bool
    {
        $secret = (string)($this->cfg['webhook_secret'] ?? '');
        $sig = (string)($headers['x-razorpay-signature'] ?? '');
        if ($secret === '' || $sig === '') return false;
        return hash_equals(hash_hmac('sha256', $rawBody, $secret), $sig);
    }

    public function parseWebhookEvent(array $event): ?array
    {
        $type = (string)($event['event'] ?? '');
        $e = $event['payload']['payment']['entity'] ?? null;
        if ($e === null) return null;
        $common = [
            'order_id'     => (string)($e['order_id'] ?? ''),
            'payment_id'   => (string)($e['id'] ?? ''),
            'amount_minor' => (int)($e['amount'] ?? 0),
            'currency'     => (string)($e['currency'] ?? ''),
        ];
        if ($type === 'payment.captured' || $type === 'order.paid') return ['status' => 'paid'] + $common;
        if ($type === 'payment.failed') return ['status' => 'failed'] + $common;
        return null;
    }
}
