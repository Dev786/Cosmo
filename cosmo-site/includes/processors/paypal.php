<?php
require_once __DIR__ . '/types.php';

/** PayPal Orders v2. amount.value is a DECIMAL STRING in major units ("3.00"), unlike
 *  Razorpay's minor int. Webhook authenticity is checked via PayPal's online
 *  verify-webhook-signature API (no local cert handling). */
final class PayPalProcessor implements PaymentProcessor
{
    public function __construct(private array $cfg) {}

    public function id(): string { return 'paypal'; }

    public static function baseFor(string $env): string
    {
        return $env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    }

    /** Minor units → PayPal's 2-decimal major-unit string. (All our currencies are 2-decimal.) */
    public static function minorToValue(int $minor): string
    {
        return number_format($minor / 100, 2, '.', '');
    }

    private function base(): string { return self::baseFor((string)($this->cfg['env'] ?? 'sandbox')); }

    /** OAuth2 client-credentials → bearer token. */
    private function token(): string
    {
        $ch = curl_init($this->base() . '/v1/oauth2/token');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERPWD        => (string)$this->cfg['client_id'] . ':' . (string)$this->cfg['secret'],
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => 'grant_type=client_credentials',
            CURLOPT_HTTPHEADER     => ['Content-Type: application/x-www-form-urlencoded'],
            CURLOPT_TIMEOUT        => 15,
        ]);
        $resp = curl_exec($ch); $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        $data = json_decode((string)$resp, true);
        if ($http >= 400 || empty($data['access_token'])) throw new RuntimeException('PayPal auth failed.');
        return (string)$data['access_token'];
    }

    private function apiPost(string $path, array $body, string $token, string $requestId = ''): array
    {
        $headers = ['Content-Type: application/json', 'Authorization: Bearer ' . $token];
        if ($requestId !== '') $headers[] = 'PayPal-Request-Id: ' . $requestId;
        $ch = curl_init($this->base() . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => $headers, CURLOPT_POSTFIELDS => json_encode($body), CURLOPT_TIMEOUT => 20,
        ]);
        $resp = curl_exec($ch); $http = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        return ['http' => $http, 'data' => json_decode((string)$resp, true) ?: []];
    }

    public function createOrder(int $minor, string $cur, string $email, string $receipt): array
    {
        if (empty($this->cfg['client_id']) || empty($this->cfg['secret'])) {
            throw new RuntimeException('PayPal is not configured.');
        }
        $token = $this->token();
        $r = $this->apiPost('/v2/checkout/orders', [
            'intent' => 'CAPTURE',
            'purchase_units' => [[
                'reference_id' => $receipt,
                'description'  => 'Cosmo coffee',
                'amount'       => ['currency_code' => $cur, 'value' => self::minorToValue($minor)],
            ]],
        ], $token, $receipt);
        if ($r['http'] >= 400 || empty($r['data']['id'])) throw new RuntimeException('PayPal order create failed.');
        return [
            'order_id' => (string)$r['data']['id'],
            'client'   => ['provider' => 'paypal', 'order_id' => (string)$r['data']['id'], 'currency' => $cur],
        ];
    }

    /** Server-side capture on the browser's onApprove. Returns the normalized result. */
    public function captureOrder(string $orderId): array
    {
        $token = $this->token();
        $r = $this->apiPost('/v2/checkout/orders/' . rawurlencode($orderId) . '/capture', [], $token, 'cap_' . $orderId);
        $cap = $r['data']['purchase_units'][0]['payments']['captures'][0] ?? null;
        $status = (string)($r['data']['status'] ?? '');
        if ($r['http'] >= 400 || $cap === null) return ['status' => 'failed', 'order_id' => $orderId];
        return [
            'status'       => $status === 'COMPLETED' ? 'paid' : 'failed',
            'order_id'     => $orderId,
            'payment_id'   => (string)($cap['id'] ?? ''),
            'amount_minor' => (int)round(((float)($cap['amount']['value'] ?? 0)) * 100),
            'currency'     => (string)($cap['amount']['currency_code'] ?? ''),
        ];
    }

    /** PayPal online verification: post the transmission headers + webhook_id + the event back. */
    public function verifyWebhook(string $rawBody, array $headers): bool
    {
        $webhookId = (string)($this->cfg['webhook_id'] ?? '');
        if ($webhookId === '') return false;
        $event = json_decode($rawBody, true);
        if (!is_array($event)) return false;
        try { $token = $this->token(); } catch (Throwable $e) { return false; }
        $r = $this->apiPost('/v1/notifications/verify-webhook-signature', [
            'auth_algo'         => $headers['paypal-auth-algo'] ?? '',
            'cert_url'          => $headers['paypal-cert-url'] ?? '',
            'transmission_id'   => $headers['paypal-transmission-id'] ?? '',
            'transmission_sig'  => $headers['paypal-transmission-sig'] ?? '',
            'transmission_time' => $headers['paypal-transmission-time'] ?? '',
            'webhook_id'        => $webhookId,
            'webhook_event'     => $event,
        ], $token);
        return ($r['data']['verification_status'] ?? '') === 'SUCCESS';
    }

    public function parseWebhookEvent(array $event): ?array
    {
        $type = (string)($event['event_type'] ?? '');
        $res  = $event['resource'] ?? null;
        if ($res === null) return null;
        $common = [
            'order_id'     => (string)($res['supplementary_data']['related_ids']['order_id'] ?? ''),
            'payment_id'   => (string)($res['id'] ?? ''),
            'amount_minor' => (int)round(((float)($res['amount']['value'] ?? 0)) * 100),
            'currency'     => (string)($res['amount']['currency_code'] ?? ''),
        ];
        if ($type === 'PAYMENT.CAPTURE.COMPLETED') return ['status' => 'paid'] + $common;
        if ($type === 'PAYMENT.CAPTURE.DENIED' || $type === 'PAYMENT.CAPTURE.REVERSED') return ['status' => 'failed'] + $common;
        return null;
    }
}
