# Multi-Currency Payments (Razorpay + PayPal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge Indian visitors in INR via Razorpay and foreign visitors in USD/EUR/GBP via PayPal, behind a swappable foreign-processor adapter, with a hardened payment path (authoritative webhooks, rate-limiting, same-origin, idempotency, salted IP hashes).

**Architecture:** A pure `currency.php` resolves country→currency→floor and currency→processor. Two adapters (`RazorpayProcessor`, `PayPalProcessor`) implement a common `PaymentProcessor` interface; a registry hands the right one to `create_order.php`. Each processor has its own verified, idempotent webhook endpoint that flips a shared `donations` row to `paid`. The browser branches its checkout UI by `provider`. Flipping `FOREIGN_PROCESSOR=razorpay` later (after Razorpay International approval) swaps PayPal out with no change to the unlock logic.

**Tech Stack:** PHP 8.4 (zero-dependency, procedural + a tiny class interface for processors), MySQL/MariaDB (PDO), vanilla JS, Razorpay Orders API + Checkout.js, PayPal Orders v2 + JS SDK. Tests are plain `php` CLI scripts (no PHPUnit/composer in this repo).

**Spec:** `docs/superpowers/specs/2026-06-10-multicurrency-razorpay-design.md` (read the REVISION block at the top first).

**Conventions:** All paths are relative to `cosmo-site/`. Run every command from `cosmo-site/`. `amount_paise` columns/fields hold **minor units** of the row's `currency` (paise/cents/pence; all four currencies use factor 100). `git` is already initialized; commit after each task, do not push.

---

## File Structure

**New:**
- `tests/lib.php` — tiny assert harness (`check`, `section`, exit code)
- `tests/run.php` — includes and runs every `tests/test_*.php`
- `tests/test_currency.php`, `tests/test_processor_routing.php`, `tests/test_api_helpers.php`, `tests/test_razorpay_adapter.php`, `tests/test_paypal_adapter.php`
- `includes/currency.php` — currency map, resolution, routing (pure; no I/O)
- `includes/processors/types.php` — `PaymentProcessor` interface
- `includes/processors/razorpay.php` — `RazorpayProcessor`
- `includes/processors/paypal.php` — `PayPalProcessor`
- `includes/processors/registry.php` — `processor_get(string $id)`
- `api/paypal_capture.php` — PayPal `onApprove` server-side capture
- `api/webhook_razorpay.php`, `api/webhook_paypal.php`
- `sql/migrations/2026-06-10-multicurrency-payments.sql`

**Modified:**
- `includes/geo.php` — add `countryCode` (ISO-2)
- `includes/api.php` — `client_ip`, `ip_hash`, `require_same_origin`, `rate_limit`, `request_headers_lower`
- `includes/db.php` — `payments` + `paypal` config blocks; enabled currencies/default/foreign processor
- `api/create_order.php` — route to the resolved processor
- `api/verify_payment.php` — Razorpay client-callback verify via the adapter (hardened)
- `includes/footer.php` — inject `window.COSMO.currency/currencies/provider/paypalClientId`; load the right SDK
- `assets/js/funnel.js` — per-currency presets, currency `<select>`, branch checkout by provider
- `support.php` — render presets in the active currency + currency select
- `sql/schema.sql` — new columns/tables for fresh installs
- `.env.example` — new keys

---

## Task 1: Test harness

**Files:**
- Create: `tests/lib.php`
- Create: `tests/run.php`

- [ ] **Step 1: Write the harness**

`tests/lib.php`:
```php
<?php
/** Zero-dependency assert harness. Tests print PASS/FAIL; run.php aggregates the exit code. */
$GLOBALS['__t'] = ['pass' => 0, 'fail' => 0];

function section(string $title): void { fwrite(STDOUT, "\n== $title ==\n"); }

function check(string $name, bool $cond): void {
    if ($cond) { $GLOBALS['__t']['pass']++; fwrite(STDOUT, "  PASS  $name\n"); }
    else       { $GLOBALS['__t']['fail']++; fwrite(STDOUT, "  FAIL  $name\n"); }
}

function eq(string $name, $actual, $expected): void {
    check($name . "  (got " . var_export($actual, true) . ")", $actual === $expected);
}

function summary_exit(): void {
    $t = $GLOBALS['__t'];
    fwrite(STDOUT, "\n{$t['pass']} passed, {$t['fail']} failed\n");
    exit($t['fail'] === 0 ? 0 : 1);
}
```

`tests/run.php`:
```php
<?php
/** Runs every tests/test_*.php in one process. Usage: php tests/run.php */
require __DIR__ . '/lib.php';
foreach (glob(__DIR__ . '/test_*.php') as $f) { require $f; }
summary_exit();
```

- [ ] **Step 2: Run it (no tests yet → passes with 0)**

Run: `php tests/run.php`
Expected: prints `0 passed, 0 failed`, exit 0.

- [ ] **Step 3: Commit**
```bash
git add cosmo-site/tests/lib.php cosmo-site/tests/run.php
git commit -m "test: add zero-dependency PHP assert harness"
```

---

## Task 2: `currency.php` — currencies, resolution, routing

**Files:**
- Create: `includes/currency.php`
- Test: `tests/test_currency.php`

- [ ] **Step 1: Write failing tests**

`tests/test_currency.php`:
```php
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
```

- [ ] **Step 2: Run → fails (file not found)**

Run: `php tests/run.php`
Expected: FAIL / fatal — `currency.php` does not exist yet.

- [ ] **Step 3: Implement `includes/currency.php`**

```php
<?php
/** Currency model + resolution + processor routing. PURE — no I/O, no globals beyond
 *  these constants. The public subset is safe to expose to the browser. `floor`/`max`
 *  are in MAJOR units; `minor` is the smallest-unit factor (all four are 2-decimal). */

const COSMO_CURRENCIES = [
    'INR' => ['symbol' => '₹', 'minor' => 100, 'floor' => 49, 'max' => 100000, 'presets' => [49, 99, 199, 499]],
    'USD' => ['symbol' => '$', 'minor' => 100, 'floor' => 3,  'max' => 1000,   'presets' => [3, 5, 10, 25]],
    'EUR' => ['symbol' => '€', 'minor' => 100, 'floor' => 3,  'max' => 1000,   'presets' => [3, 5, 10, 25]],
    'GBP' => ['symbol' => '£', 'minor' => 100, 'floor' => 3,  'max' => 1000,   'presets' => [3, 5, 10, 25]],
];
const COSMO_DEFAULT_CURRENCY = 'USD';

/** Eurozone ISO-3166-1 alpha-2 codes (the 20 EUR-using members relevant to card geo). */
const COSMO_EUROZONE = ['AT','BE','HR','CY','EE','FI','FR','DE','GR','IE','IT','LV','LT','LU','MT','NL','PT','SK','SI','ES'];

function currency_for_country(string $iso): string
{
    $iso = strtoupper(trim($iso));
    if ($iso === 'IN') return 'INR';
    if ($iso === 'US') return 'USD';
    if ($iso === 'GB') return 'GBP';
    if (in_array($iso, COSMO_EUROZONE, true)) return 'EUR';
    return COSMO_DEFAULT_CURRENCY;
}

/** Override (if enabled) → geo-derived (if enabled) → default. Always returns an enabled currency. */
function resolve_currency(?string $override, string $geoIso, array $enabled, string $default): string
{
    $default = in_array($default, $enabled, true) ? $default : ($enabled[0] ?? 'USD');
    if ($override !== null) {
        $o = strtoupper(trim($override));
        if (in_array($o, $enabled, true)) return $o;
    }
    $geo = currency_for_country($geoIso);
    return in_array($geo, $enabled, true) ? $geo : $default;
}

function currency_meta(string $cur): array
{
    $cur = strtoupper(trim($cur));
    return COSMO_CURRENCIES[$cur] ?? COSMO_CURRENCIES[COSMO_DEFAULT_CURRENCY];
}

function to_minor(int $major, string $cur): int
{
    return $major * currency_meta($cur)['minor'];
}

/** INR is always Razorpay (UPI). Everything else uses the configured foreign processor
 *  ('paypal' now; flip to 'razorpay' once International Payments is approved). */
function processor_for_currency(string $cur, string $foreignProcessor): string
{
    return strtoupper(trim($cur)) === 'INR' ? 'razorpay' : $foreignProcessor;
}

/** The browser-safe subset: symbol/floor/presets per enabled currency. No internal max/minor. */
function public_currency_map(array $enabled): array
{
    $out = [];
    foreach ($enabled as $cur) {
        if (!isset(COSMO_CURRENCIES[$cur])) continue;
        $m = COSMO_CURRENCIES[$cur];
        $out[$cur] = ['symbol' => $m['symbol'], 'floor' => $m['floor'], 'presets' => $m['presets']];
    }
    return $out;
}
```

- [ ] **Step 4: Run → passes**

Run: `php tests/run.php`
Expected: all currency checks PASS, exit 0.

- [ ] **Step 5: Commit**
```bash
git add cosmo-site/includes/currency.php cosmo-site/tests/test_currency.php
git commit -m "feat(site): currency model, resolution, and processor routing"
```

---

## Task 3: `geo.php` — add ISO country code

**Files:**
- Modify: `includes/geo.php`

- [ ] **Step 1: Add `countryCode` to the ip-api fields and return value**

In `includes/geo.php`, change the `$empty` default, the fields in `$url`, and the returned array:

Replace:
```php
    $empty = ['country' => '', 'city' => ''];
```
with:
```php
    $empty = ['country' => '', 'countryCode' => '', 'city' => ''];
```

Replace:
```php
    $url = "http://ip-api.com/json/" . urlencode($ip) . "?fields=status,country,city";
```
with:
```php
    $url = "http://ip-api.com/json/" . urlencode($ip) . "?fields=status,country,countryCode,city";
```

Replace:
```php
    return [
        'country' => (string)($data['country'] ?? ''),
        'city'    => (string)($data['city'] ?? ''),
    ];
```
with:
```php
    return [
        'country'     => (string)($data['country'] ?? ''),
        'countryCode' => (string)($data['countryCode'] ?? ''),
        'city'        => (string)($data['city'] ?? ''),
    ];
```

- [ ] **Step 2: Lint**

Run: `php -l includes/geo.php`
Expected: `No syntax errors detected`.

- [ ] **Step 3: Confirm existing callers still work**

Run: `grep -rn "geo_lookup" cosmo-site --include=*.php`
Expected: callers read `['country']`/`['city']` — both still present (additive change, nothing broken).

- [ ] **Step 4: Commit**
```bash
git add cosmo-site/includes/geo.php
git commit -m "feat(site): geo_lookup returns ISO countryCode for currency routing"
```

---

## Task 4: `api.php` — shared security helpers

**Files:**
- Modify: `includes/api.php`
- Test: `tests/test_api_helpers.php`

- [ ] **Step 1: Write failing tests** (pure parts: ip_hash determinism, header lowercasing, origin host match)

`tests/test_api_helpers.php`:
```php
<?php
putenv('IP_SALT=test-salt-123');           // env() reads getenv(); set before include
require_once __DIR__ . '/../includes/api.php';

section('ip_hash');
eq('deterministic', ip_hash('1.2.3.4'), ip_hash('1.2.3.4'));
check('differs by ip', ip_hash('1.2.3.4') !== ip_hash('1.2.3.5'));
eq('is sha256 hex (64 chars)', strlen(ip_hash('1.2.3.4')), 64);
check('salted (not bare sha256)', ip_hash('1.2.3.4') !== hash('sha256', '1.2.3.4'));

section('origin_host_matches');
check('same host ok', origin_host_matches('https://cosmo.app/x', 'https://cosmo.app'));
check('different host rejected', !origin_host_matches('https://evil.com', 'https://cosmo.app'));
check('empty origin allowed (no header)', origin_host_matches('', 'https://cosmo.app'));
check('empty site_url → skip (dev)', origin_host_matches('https://anything.com', ''));

section('rate_window_start floors to bucket');
eq('600s bucket', rate_window_start(1718000123, 600), 1718000100); // 1718000123 - (123%600=...) → bucket
```
> The `rate_window_start(1718000123, 600)` expectation: `1718000123 % 600 = 323`, so bucket start = `1718000123 - 323 = 1717999800`. Use that exact value:
```php
eq('600s bucket', rate_window_start(1718000123, 600), 1717999800);
```
(Delete the wrong line above; keep only this corrected one.)

- [ ] **Step 2: Run → fails (functions undefined)**

Run: `php tests/run.php`
Expected: fatal/FAIL — `ip_hash`/`origin_host_matches`/`rate_window_start` undefined.

- [ ] **Step 3: Implement — append to `includes/api.php`** (before the closing `?>` if any; this file currently ends after `api_config()`)

```php

/** Build a lowercased header map from $_SERVER (works on Apache/nginx/CLI; no getallheaders dependency). */
function request_headers_lower(): array
{
    $h = [];
    foreach ($_SERVER as $k => $v) {
        if (str_starts_with($k, 'HTTP_')) {
            $name = strtolower(str_replace('_', '-', substr($k, 5)));
            $h[$name] = $v;
        }
    }
    return $h;
}

/** Best-effort client IP: first hop of X-Forwarded-For (Hostinger sits behind a proxy) → REMOTE_ADDR. */
function client_ip(): string
{
    $xff = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
    if ($xff !== '') { $first = trim(explode(',', $xff)[0]); if ($first !== '') return $first; }
    return (string)($_SERVER['REMOTE_ADDR'] ?? '');
}

/** Salted SHA-256 of an IP — we never store raw IPs. Salt from .env (IP_SALT). */
function ip_hash(string $ip): string
{
    return hash('sha256', $ip . '|' . (string)env('IP_SALT', 'cosmo-default-salt'));
}

/** Pure: does the request Origin/Referer host equal the site host? Empty origin or empty site = allow. */
function origin_host_matches(string $origin, string $siteUrl): bool
{
    if ($origin === '' || $siteUrl === '') return true;            // no header (some browsers) / dev box
    $oh = parse_url($origin, PHP_URL_HOST);
    $sh = parse_url($siteUrl, PHP_URL_HOST);
    return $oh !== null && $sh !== null && strcasecmp($oh, $sh) === 0;
}

/** 403 unless the request's Origin (or Referer) host matches the configured site_url host. */
function require_same_origin(): void
{
    $cfg = cosmo_config();
    $site = (string)($cfg['site_url'] ?? '');
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '');
    if (!origin_host_matches($origin, $site)) json_out(['error' => 'Bad origin.'], 403);
}

/** Pure: fixed-window bucket start (unix seconds) for a timestamp + window length. */
function rate_window_start(int $now, int $windowSec): int
{
    return $now - ($now % $windowSec);
}

/** Per-IP fixed-window limiter. Over `cap` hits in `windowSec` → 429. Fail-open on DB errors
 *  (never block a paying user because a logging table hiccuped). */
function rate_limit(string $action, int $cap, int $windowSec): void
{
    try {
        $bucket = gmdate('Y-m-d H:i:s', rate_window_start(time(), $windowSec));
        $h = ip_hash(client_ip());
        $pdo = db();
        $pdo->prepare(
            'INSERT INTO rate_limits (ip_hash, action, window_start, hits) VALUES (:h, :a, :w, 1)
             ON DUPLICATE KEY UPDATE hits = hits + 1'
        )->execute([':h' => $h, ':a' => $action, ':w' => $bucket]);
        $hits = (int)$pdo->query(
            'SELECT hits FROM rate_limits WHERE ip_hash = ' . $pdo->quote($h) .
            ' AND action = ' . $pdo->quote($action) . ' AND window_start = ' . $pdo->quote($bucket)
        )->fetchColumn();
        // Opportunistic cleanup (~1 in 20 calls) to keep the table small.
        if (($hits % 20) === 0) {
            $pdo->exec("DELETE FROM rate_limits WHERE window_start < (UTC_TIMESTAMP() - INTERVAL 1 DAY)");
        }
        if ($hits > $cap) json_out(['error' => 'Too many requests — slow down a moment.'], 429);
    } catch (Throwable $e) { /* fail-open */ }
}
```

- [ ] **Step 4: Run → passes** (the four pure functions; DB-touching `rate_limit`/`require_same_origin` are covered later by manual + endpoint tests)

Run: `php tests/run.php`
Expected: api-helper checks PASS, exit 0.

- [ ] **Step 5: Commit**
```bash
git add cosmo-site/includes/api.php cosmo-site/tests/test_api_helpers.php
git commit -m "feat(site): client_ip, salted ip_hash, same-origin guard, rate limiter"
```

---

## Task 5: DB schema + migration

**Files:**
- Create: `sql/migrations/2026-06-10-multicurrency-payments.sql`
- Modify: `sql/schema.sql`

- [ ] **Step 1: Write the migration** (`sql/migrations/2026-06-10-multicurrency-payments.sql`)

```sql
-- Run once on the server. donations.amount_paise now stores MINOR UNITS of `currency`.
ALTER TABLE donations ADD COLUMN processor VARCHAR(16) NULL AFTER status;
ALTER TABLE donations ADD COLUMN country   VARCHAR(2)  NULL AFTER currency;
ALTER TABLE donations ADD COLUMN ip_hash   CHAR(64)    NULL AFTER country;

CREATE TABLE IF NOT EXISTS webhook_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  processor   VARCHAR(16) NOT NULL,
  event_id    VARCHAR(80) NOT NULL,
  type        VARCHAR(64) NOT NULL,
  received_at DATETIME    NOT NULL,
  UNIQUE KEY uniq_event (processor, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rate_limits (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_hash      CHAR(64)    NOT NULL,
  action       VARCHAR(32) NOT NULL,
  window_start DATETIME    NOT NULL,
  hits         INT         NOT NULL DEFAULT 1,
  UNIQUE KEY uniq_bucket (ip_hash, action, window_start),
  INDEX idx_rl_window (window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Update `sql/schema.sql` for fresh installs** — add the three columns to the `donations` CREATE TABLE and append the two new tables.

In `sql/schema.sql`, inside `CREATE TABLE IF NOT EXISTS donations (...)`, add after the `status` line:
```sql
    processor            VARCHAR(16),
    country              VARCHAR(2),
    ip_hash              CHAR(64),
```
Then append the `webhook_events` and `rate_limits` `CREATE TABLE` blocks (identical to the migration above) to the end of the file.

- [ ] **Step 3: Validate SQL parses** (syntax sanity without a DB)

Run: `php -r '$s=file_get_contents("sql/schema.sql"); echo (substr_count($s,"CREATE TABLE")>=4 && str_contains($s,"webhook_events") && str_contains($s,"rate_limits")) ? "OK\n" : "MISSING\n";'`
Expected: `OK`.

- [ ] **Step 4: Commit**
```bash
git add cosmo-site/sql/schema.sql cosmo-site/sql/migrations/2026-06-10-multicurrency-payments.sql
git commit -m "feat(site): schema for processor/country/ip_hash, webhook dedup, rate limits"
```

---

## Task 6: Processor interface + registry

**Files:**
- Create: `includes/processors/types.php`
- Create: `includes/processors/registry.php`

- [ ] **Step 1: Write the interface** (`includes/processors/types.php`)

```php
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
```

- [ ] **Step 2: Write the registry** (`includes/processors/registry.php`)

```php
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
```

- [ ] **Step 3: Lint** (will fail until Tasks 7–8 create the adapter files; that's expected — do not run yet). Skip to Task 7.

- [ ] **Step 4: Commit** (after Task 8 lints clean — defer commit; or commit interface now)
```bash
git add cosmo-site/includes/processors/types.php
git commit -m "feat(site): PaymentProcessor interface"
```

---

## Task 7: Razorpay adapter

**Files:**
- Create: `includes/processors/razorpay.php`
- Test: `tests/test_razorpay_adapter.php`

- [ ] **Step 1: Write failing tests** (pure: signature verification + webhook parsing)

`tests/test_razorpay_adapter.php`:
```php
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
```

- [ ] **Step 2: Run → fails** (`RazorpayProcessor` undefined)

Run: `php tests/run.php`
Expected: fatal/FAIL.

- [ ] **Step 3: Implement** (`includes/processors/razorpay.php`)

```php
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
```

- [ ] **Step 4: Run → passes**

Run: `php tests/run.php`
Expected: Razorpay adapter checks PASS.

- [ ] **Step 5: Commit**
```bash
git add cosmo-site/includes/processors/razorpay.php cosmo-site/tests/test_razorpay_adapter.php
git commit -m "feat(site): Razorpay processor adapter (order, client+webhook verify, parse)"
```

---

## Task 8: PayPal adapter

**Files:**
- Create: `includes/processors/paypal.php`
- Test: `tests/test_paypal_adapter.php`

- [ ] **Step 1: Write failing tests** (pure: amount formatting + webhook event parsing; live API calls are manual)

`tests/test_paypal_adapter.php`:
```php
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
eq('denied → failed', $pp->parseWebhookEvent(['event_type' => 'PAYMENT.CAPTURE.DENIED',
    'resource' => ['id' => 'c', 'amount' => ['currency_code' => 'USD', 'value' => '5.00'],
    'supplementary_data' => ['related_ids' => ['order_id' => 'o']]])['status'], 'failed');
check('unrelated event → null', $pp->parseWebhookEvent(['event_type' => 'BILLING.SUBSCRIPTION.CREATED']) === null);
```

- [ ] **Step 2: Run → fails** (`PayPalProcessor` undefined)

Run: `php tests/run.php`
Expected: fatal/FAIL.

- [ ] **Step 3: Implement** (`includes/processors/paypal.php`)

```php
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
```

- [ ] **Step 4: Run → passes**

Run: `php tests/run.php`
Expected: PayPal adapter checks PASS.

- [ ] **Step 5: Lint the registry now that both adapters exist**

Run: `php -l includes/processors/registry.php`
Expected: `No syntax errors detected`.

- [ ] **Step 6: Commit**
```bash
git add cosmo-site/includes/processors/paypal.php cosmo-site/includes/processors/registry.php cosmo-site/tests/test_paypal_adapter.php
git commit -m "feat(site): PayPal Orders v2 adapter + processor registry"
```

---

## Task 9: Config — db.php + .env.example

**Files:**
- Modify: `includes/db.php`
- Modify: `.env.example`

- [ ] **Step 1: Add `payments` + `paypal` config blocks in `cosmo_config()`**

In `includes/db.php`, inside the `$cfg = [ ... ]` array, after the existing `'razorpay' => [ ... ],` block, add:
```php
            'paypal' => [
                'client_id'  => env('PAYPAL_CLIENT_ID', ''),
                'secret'     => env('PAYPAL_SECRET', ''),
                'webhook_id' => env('PAYPAL_WEBHOOK_ID', ''),
                'env'        => env('PAYPAL_ENV', 'sandbox'),  // 'sandbox' | 'live'
            ],
            'payments' => [
                'enabled_currencies' => array_values(array_intersect(
                    array_map('trim', explode(',', (string)env('PAYMENT_CURRENCIES', 'INR,USD,EUR,GBP'))),
                    ['INR', 'USD', 'EUR', 'GBP']
                )),
                'default_currency'   => env('PAYMENT_DEFAULT_CURRENCY', 'USD'),
                'foreign_processor'  => env('FOREIGN_PROCESSOR', 'paypal'),  // 'paypal' | 'razorpay'
            ],
```

- [ ] **Step 2: Add the keys to `.env.example`** — after the existing `RAZORPAY_PRESETS=99,199,499` line:
```
# Currencies/regions: INR→Razorpay (India), others→FOREIGN_PROCESSOR. Foreign floor is $3/€3/£3 (set in includes/currency.php).
PAYMENT_CURRENCIES=INR,USD,EUR,GBP
PAYMENT_DEFAULT_CURRENCY=USD
FOREIGN_PROCESSOR=paypal

# Salt for hashing visitor IPs (rate-limit + abuse). Any long random string; never raw IPs are stored.
IP_SALT=

# --- PayPal (developer.paypal.com → Apps & Credentials). Start in Sandbox. ---
# CLIENT_ID is public (loaded by the JS SDK); SECRET + WEBHOOK_ID are server-only.
PAYPAL_CLIENT_ID=
PAYPAL_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_ENV=sandbox
```
> Leave `RAZORPAY_CURRENCY`/`RAZORPAY_PRESETS` in place (superseded by `includes/currency.php`, but harmless).

- [ ] **Step 3: Lint + smoke-test config parsing**

Run: `php -l includes/db.php`
Run: `php -r 'putenv("PAYMENT_CURRENCIES=INR,USD"); require "includes/db.php"; $c=cosmo_config(); var_export($c["payments"]["enabled_currencies"] ?? "no-env");'`
Expected: lint clean; second prints `array('INR','USD')` if `.env` exists, or `'no-env'`/null if not (acceptable — proves no fatal).

- [ ] **Step 4: Commit**
```bash
git add cosmo-site/includes/db.php cosmo-site/.env.example
git commit -m "feat(site): payments + paypal config blocks and .env keys"
```

---

## Task 10: `create_order.php` — route to the resolved processor

**Files:**
- Modify: `api/create_order.php` (full rewrite)
- Test: `tests/test_processor_routing.php`

- [ ] **Step 1: Write failing routing test** (pure resolution wiring — currency + processor from a fake geo/config)

`tests/test_processor_routing.php`:
```php
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
```

- [ ] **Step 2: Run → passes** (it only exercises Task 2 code; this test documents the routing contract `create_order.php` must honor)

Run: `php tests/run.php`
Expected: PASS.

- [ ] **Step 3: Rewrite `api/create_order.php`**

```php
<?php
/** Create a payment order with the processor that serves the visitor's currency:
 *  INR→Razorpay, foreign→FOREIGN_PROCESSOR (PayPal). Currency is decided server-side
 *  (override∈enabled → geo → default) and the floor is enforced here. */
require_once __DIR__ . '/../includes/api.php';
require_once __DIR__ . '/../includes/geo.php';
require_once __DIR__ . '/../includes/currency.php';
require_once __DIR__ . '/../includes/processors/registry.php';

require_post();
require_same_origin();
rate_limit('order', 12, 600);

$cfg = api_config();
$pay = $cfg['payments'] ?? ['enabled_currencies' => ['INR'], 'default_currency' => 'INR', 'foreign_processor' => 'paypal'];

$in     = json_input();
$email  = strtolower(trim((string)($in['email'] ?? '')));
$amount = (int)($in['amount'] ?? 0);
$override = isset($in['currency']) ? (string)$in['currency'] : null;

$geoIso = geo_lookup(client_ip())['countryCode'] ?? '';
$cur    = resolve_currency($override, $geoIso, $pay['enabled_currencies'], (string)$pay['default_currency']);
$meta   = currency_meta($cur);

if ($amount < $meta['floor'] || $amount > $meta['max']) {
    json_out(['error' => "Pick at least {$meta['symbol']}{$meta['floor']}."], 422);
}

$procId  = processor_for_currency($cur, (string)$pay['foreign_processor']);
$minor   = to_minor($amount, $cur);
$receipt = 'cosmo_' . bin2hex(random_bytes(6));   // ≤40 chars, unique → also the provider idempotency key

try {
    $proc  = processor_get($procId);
    $order = $proc->createOrder($minor, $cur, $email, $receipt);
} catch (Throwable $e) {
    json_out(['error' => 'Could not start the payment. Please try again.'], 502);
}

// Record the pending order so the webhook / verify can complete it.
try {
    db()->prepare(
        'INSERT INTO donations (created_at, email, amount_paise, currency, country, ip_hash, processor, razorpay_order_id, status)
         VALUES (NOW(), :email, :amt, :cur, :country, :iph, :proc, :oid, "created")'
    )->execute([
        ':email' => $email, ':amt' => $minor, ':cur' => $cur, ':country' => substr($geoIso, 0, 2),
        ':iph' => ip_hash(client_ip()), ':proc' => $procId, ':oid' => $order['order_id'],
    ]);
} catch (Throwable $e) { /* non-fatal: payment can still proceed */ }

json_out(['ok' => true, 'provider' => $procId, 'currency' => $cur] + $order['client']);
```
> Reuses the existing `donations.razorpay_order_id` column as the generic provider order id (both processors store their order id here; `processor` disambiguates). No new column needed for the id.

- [ ] **Step 4: Lint**

Run: `php -l api/create_order.php`
Expected: `No syntax errors detected`.

- [ ] **Step 5: Commit**
```bash
git add cosmo-site/api/create_order.php cosmo-site/tests/test_processor_routing.php
git commit -m "feat(site): create_order routes to processor by resolved currency + enforces floor"
```

---

## Task 11: `verify_payment.php` — Razorpay client callback via the adapter

**Files:**
- Modify: `api/verify_payment.php` (full rewrite)

- [ ] **Step 1: Rewrite** (delegates signature to the adapter; adds same-origin + rate-limit; idempotent flip)

```php
<?php
/** Verify a Razorpay browser callback server-side, then release the repo URL. Razorpay
 *  only — PayPal confirms via capture + webhook. The webhook is the backstop if this
 *  call never arrives (tab closed). */
require_once __DIR__ . '/../includes/api.php';
require_once __DIR__ . '/../includes/processors/registry.php';

require_post();
require_same_origin();
rate_limit('verify', 30, 600);

$cfg = api_config();
$in        = json_input();
$orderId   = (string)($in['razorpay_order_id'] ?? '');
$paymentId = (string)($in['razorpay_payment_id'] ?? '');
$signature = (string)($in['razorpay_signature'] ?? '');
$email     = strtolower(trim((string)($in['email'] ?? '')));

if ($orderId === '' || $paymentId === '' || $signature === '') {
    json_out(['error' => 'Missing payment fields.'], 422);
}

$rzp = processor_get('razorpay');
if (!$rzp->verifyClientSignature($orderId, $paymentId, $signature)) {
    try {
        db()->prepare('UPDATE donations SET status = "failed", razorpay_payment_id = :pid
                       WHERE razorpay_order_id = :oid AND status = "created"')
            ->execute([':pid' => $paymentId, ':oid' => $orderId]);
    } catch (Throwable $e) {}
    json_out(['error' => 'Payment could not be verified.'], 400);
}

// Verified — complete the donation (idempotent: don't override a webhook that already paid it).
try {
    db()->prepare(
        'UPDATE donations SET status = "paid", razorpay_payment_id = :pid,
         email = COALESCE(NULLIF(:email, ""), email)
         WHERE razorpay_order_id = :oid AND status IN ("created","failed")'
    )->execute([':pid' => $paymentId, ':email' => $email, ':oid' => $orderId]);
} catch (Throwable $e) { /* payment still valid even if the row update hiccups */ }

json_out(['ok' => true, 'repo_url' => (string)$cfg['repo_url']]);
```

- [ ] **Step 2: Lint**

Run: `php -l api/verify_payment.php`
Expected: `No syntax errors detected`.

- [ ] **Step 3: Commit**
```bash
git add cosmo-site/api/verify_payment.php
git commit -m "refactor(site): verify_payment delegates to Razorpay adapter + same-origin/rate-limit"
```

---

## Task 12: `paypal_capture.php` — server-side capture on approve

**Files:**
- Create: `api/paypal_capture.php`

- [ ] **Step 1: Implement** (browser `onApprove` posts the PayPal order id; we capture server-side, mark paid, release URL)

```php
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
```

- [ ] **Step 2: Lint**

Run: `php -l api/paypal_capture.php`
Expected: `No syntax errors detected`.

- [ ] **Step 3: Commit**
```bash
git add cosmo-site/api/paypal_capture.php
git commit -m "feat(site): PayPal server-side capture endpoint with amount cross-check"
```

---

## Task 13: Webhook endpoints (Razorpay + PayPal)

**Files:**
- Create: `api/webhook_razorpay.php`
- Create: `api/webhook_paypal.php`

- [ ] **Step 1: Shared webhook completion helper — append to `includes/api.php`**

```php

/** Idempotently apply a normalized webhook result to the donations row. Returns true if
 *  this event was newly processed, false if it was a duplicate (already recorded). */
function webhook_apply(string $processor, string $eventId, string $eventType, ?array $norm): bool
{
    if ($eventId === '') return true;            // can't dedup → process once, best effort
    $pdo = db();
    try {
        $ins = $pdo->prepare('INSERT IGNORE INTO webhook_events (processor, event_id, type, received_at)
                              VALUES (:p, :e, :t, NOW())');
        $ins->execute([':p' => $processor, ':e' => $eventId, ':t' => $eventType]);
        if ($ins->rowCount() === 0) return false;   // duplicate delivery
    } catch (Throwable $e) { /* if dedup insert fails, fall through and still apply */ }

    if ($norm === null) return true;                // verified but not a status event we act on
    $oid = (string)($norm['order_id'] ?? '');
    if ($oid === '') return true;
    try {
        if ($norm['status'] === 'paid') {
            $pdo->prepare('UPDATE donations SET status = "paid", razorpay_payment_id = :pid
                           WHERE razorpay_order_id = :oid AND status IN ("created","failed")')
                ->execute([':pid' => (string)($norm['payment_id'] ?? ''), ':oid' => $oid]);
        } elseif ($norm['status'] === 'failed') {
            $pdo->prepare('UPDATE donations SET status = "failed", razorpay_payment_id = :pid
                           WHERE razorpay_order_id = :oid AND status = "created"')
                ->execute([':pid' => (string)($norm['payment_id'] ?? ''), ':oid' => $oid]);
        }
    } catch (Throwable $e) { /* non-fatal */ }
    return true;
}
```

- [ ] **Step 2: `api/webhook_razorpay.php`**

```php
<?php
/** Razorpay's authoritative, retried, server-to-server confirmation. Verify the raw-body
 *  HMAC signature BEFORE parsing, dedup by event id, then idempotently mark the row. */
require_once __DIR__ . '/../includes/api.php';
require_once __DIR__ . '/../includes/processors/registry.php';

require_post();                                   // no same-origin/rate-limit: caller is Razorpay, auth is the signature
$raw     = file_get_contents('php://input') ?: '';
$headers = request_headers_lower();

$rzp = processor_get('razorpay');
if (!$rzp->verifyWebhook($raw, $headers)) { http_response_code(400); echo 'bad signature'; exit; }

$event   = json_decode($raw, true) ?: [];
$eventId = (string)($headers['x-razorpay-event-id'] ?? '');
$norm    = $rzp->parseWebhookEvent($event);
webhook_apply('razorpay', $eventId, (string)($event['event'] ?? ''), $norm);

http_response_code(200); echo 'ok';
```

- [ ] **Step 3: `api/webhook_paypal.php`**

```php
<?php
/** PayPal's authoritative confirmation. Verify via PayPal's online verify-webhook-signature
 *  API BEFORE trusting, dedup by transmission/event id, then idempotently mark the row. */
require_once __DIR__ . '/../includes/api.php';
require_once __DIR__ . '/../includes/processors/registry.php';

require_post();
$raw     = file_get_contents('php://input') ?: '';
$headers = request_headers_lower();

$pp = processor_get('paypal');
if (!$pp->verifyWebhook($raw, $headers)) { http_response_code(400); echo 'bad signature'; exit; }

$event   = json_decode($raw, true) ?: [];
$eventId = (string)($event['id'] ?? ($headers['paypal-transmission-id'] ?? ''));
$norm    = $pp->parseWebhookEvent($event);
webhook_apply('paypal', $eventId, (string)($event['event_type'] ?? ''), $norm);

http_response_code(200); echo 'ok';
```

- [ ] **Step 4: Lint all three**

Run: `php -l includes/api.php && php -l api/webhook_razorpay.php && php -l api/webhook_paypal.php`
Expected: `No syntax errors detected` ×3.

- [ ] **Step 5: Commit**
```bash
git add cosmo-site/includes/api.php cosmo-site/api/webhook_razorpay.php cosmo-site/api/webhook_paypal.php
git commit -m "feat(site): idempotent Razorpay + PayPal webhook endpoints"
```

---

## Task 14: Inject currency/provider config into the page

**Files:**
- Modify: `includes/footer.php`

- [ ] **Step 1: Replace the `window.COSMO` block + SDK loading**

In `includes/footer.php`, at the top (the `<?php $cfg = cosmo_config(); ...` block at line 1–5), add currency resolution. Replace:
```php
<?php
$cfg = cosmo_config();
$rzp = $cfg['razorpay'] ?? ['key_id' => '', 'currency' => 'INR', 'preset_amounts' => [99, 199, 499]];
$year = date('Y');
?>
```
with:
```php
<?php
require_once __DIR__ . '/geo.php';
require_once __DIR__ . '/currency.php';
$cfg  = cosmo_config();
$rzp  = $cfg['razorpay'] ?? ['key_id' => ''];
$pay  = $cfg['payments'] ?? ['enabled_currencies' => ['INR'], 'default_currency' => 'INR', 'foreign_processor' => 'paypal'];
$ppal = $cfg['paypal'] ?? ['client_id' => '', 'env' => 'sandbox'];
$cwCur   = resolve_currency(null, geo_lookup(client_ip())['countryCode'] ?? '', $pay['enabled_currencies'], (string)$pay['default_currency']);
$cwProc  = processor_for_currency($cwCur, (string)$pay['foreign_processor']);
$cwMap   = public_currency_map($pay['enabled_currencies']);
$year = date('Y');
?>
```

Replace the `<script> window.COSMO = {...}; </script>` block (the one with `razorpayKeyId`/`currency`/`presets`) with:
```php
<script>
  // Public config only: publishable keys + the currency map (symbol/floor/presets). No secrets.
  window.COSMO = {
    razorpayKeyId: <?= json_encode($rzp['key_id'] ?? '', JSON_UNESCAPED_SLASHES) ?>,
    paypalClientId: <?= json_encode($ppal['client_id'] ?? '', JSON_UNESCAPED_SLASHES) ?>,
    paypalEnv: <?= json_encode($ppal['env'] ?? 'sandbox') ?>,
    currency: <?= json_encode($cwCur) ?>,
    provider: <?= json_encode($cwProc) ?>,
    currencies: <?= json_encode($cwMap, JSON_UNESCAPED_SLASHES) ?>
  };
</script>
```

Then update the SDK `<script>` tags — keep Razorpay's checkout.js, and add PayPal's SDK only when a client id is present and PayPal is in use. Replace:
```php
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```
with:
```php
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<?php if (!empty($ppal['client_id'])): $ppCurs = implode(',', array_values(array_diff($pay['enabled_currencies'], ['INR']))); ?>
<script src="https://www.paypal.com/sdk/js?client-id=<?= rawurlencode($ppal['client_id']) ?>&currency=<?= rawurlencode($cwCur === 'INR' ? ($pay['default_currency'] ?? 'USD') : $cwCur) ?>&components=buttons&intent=capture"></script>
<?php endif; ?>
```
> PayPal's SDK is initialized with a single currency; if the user switches currency in the dropdown, funnel.js re-loads the SDK with the new currency (Task 15). `$ppCurs` is unused here but documents intent; omit if linter warns.

Simplify — drop the unused `$ppCurs`:
```php
<?php if (!empty($ppal['client_id'])): ?>
<script src="https://www.paypal.com/sdk/js?client-id=<?= rawurlencode($ppal['client_id']) ?>&currency=<?= rawurlencode($cwCur === 'INR' ? ($pay['default_currency'] ?? 'USD') : $cwCur) ?>&components=buttons&intent=capture"></script>
<?php endif; ?>
```

- [ ] **Step 2: Lint + render check**

Run: `php -l includes/footer.php`
Run: `curl -s http://127.0.0.1:8094/index.php | grep -o 'window.COSMO = {' | head -1`
Expected: lint clean; grep finds the block (start the PHP server first if needed: `php -S 127.0.0.1:8094 -t cosmo-site` from repo root).

- [ ] **Step 3: Commit**
```bash
git add cosmo-site/includes/footer.php
git commit -m "feat(site): inject resolved currency/provider + currency map; load PayPal SDK"
```

---

## Task 15: Checkout UI — presets, currency select, provider branch

**Files:**
- Modify: `assets/js/funnel.js`
- Modify: `support.php`
- Modify: `includes/footer.php` (add a currency `<select>` + a PayPal button mount to the modal)

- [ ] **Step 1: Add the currency select + PayPal mount to the modal** (`includes/footer.php`, inside `#tip-row` area)

Replace the server-rendered preset buttons block:
```php
        <div class="tips__row" id="tip-row">
          <?php foreach ($rzp['preset_amounts'] as $amt): ?>
            <button type="button" class="tip" data-amt="<?= (int)$amt ?>">₹<?= (int)$amt ?></button>
          <?php endforeach; ?>
          <input class="tip-custom" type="number" min="1" step="1" name="custom" placeholder="₹ custom">
        </div>
```
with (presets now rendered by JS from `window.COSMO.currencies`; add a currency picker + PayPal mount):
```php
        <div class="tips__row" id="tip-row">
          <input class="tip-custom" type="number" min="1" step="1" name="custom" placeholder="custom">
        </div>
        <div class="tips__cur">
          <label for="cur-select" class="tips__curlabel">Currency</label>
          <select id="cur-select" aria-label="Currency"></select>
        </div>
        <div id="paypal-buttons" hidden></div>
```

- [ ] **Step 2: Rewrite the tipping parts of `assets/js/funnel.js`**

Add near the top (after `let modalEyes = null;`):
```js
  const CUR = window.COSMO.currencies || {};
  let curCode = window.COSMO.currency || 'USD';
  let provider = window.COSMO.provider || 'razorpay';
  const hasPaypal = !!window.COSMO.paypalClientId;
```

Add a preset+select renderer and wire the currency change. Insert after `function selectAmount(...)`:
```js
  function meta() { return CUR[curCode] || { symbol: '', floor: 1, presets: [] }; }

  function renderCurrencyUI() {
    const row = document.getElementById('tip-row');
    const custom = row && row.querySelector('input[name=custom]');
    // Remove old preset buttons (keep the custom input).
    row && row.querySelectorAll('.tip').forEach((b) => b.remove());
    const m = meta();
    m.presets.forEach((amt) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'tip'; b.dataset.amt = String(amt);
      b.textContent = m.symbol + amt;
      b.addEventListener('click', () => selectAmount(amt));
      row.insertBefore(b, custom);
    });
    if (custom) custom.placeholder = m.symbol + ' custom (min ' + m.symbol + m.floor + ')';
    // currency <select>
    const sel = document.getElementById('cur-select');
    if (sel && !sel.dataset.built) {
      Object.keys(CUR).forEach((code) => {
        const o = document.createElement('option');
        o.value = code; o.textContent = code + ' (' + CUR[code].symbol + ')';
        sel.appendChild(o);
      });
      sel.dataset.built = '1';
      sel.addEventListener('change', () => setCurrency(sel.value));
    }
    if (sel) sel.value = curCode;
    selectedAmt = 0;
  }

  function setCurrency(code) {
    if (!CUR[code]) return;
    curCode = code;
    provider = (code === 'INR') ? 'razorpay' : (window.COSMO.foreignProvider || provider);
    // INR always Razorpay; foreign uses the configured provider (provider stays as injected).
    if (code !== 'INR') provider = window.COSMO.provider === 'razorpay' ? 'razorpay' : 'paypal';
    else provider = 'razorpay';
    renderCurrencyUI();
    setupPaypalIfNeeded();
  }
```
> Simplify the `setCurrency` provider logic — `window.COSMO.provider` reflects the foreign processor when the page loaded foreign; for INR it's always razorpay. Use:
```js
  function setCurrency(code) {
    if (!CUR[code]) return;
    curCode = code;
    provider = (code === 'INR') ? 'razorpay' : (hasPaypal ? 'paypal' : 'razorpay');
    renderCurrencyUI();
    setupPaypalIfNeeded();
  }
```

Replace `runPayment` so it branches by provider:
```js
  async function runPayment(email) {
    const order = await postJSON('api/create_order.php', { amount: selectedAmt, email: email, currency: curCode });
    if (order.provider === 'paypal') return runPaypal(order, email);
    return runRazorpay(order, email);
  }

  function runRazorpay(order, email) {
    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay({
        key: order.key_id, order_id: order.order_id, amount: order.amount, currency: order.currency,
        name: 'Cosmo', description: 'Buy me a coffee ☕',
        prefill: { email: email }, theme: { color: '#4a9eff' },
        handler: async (resp) => {
          try {
            const v = await postJSON('api/verify_payment.php', {
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature, email: email,
            });
            resolve(v);
          } catch (err) { reject(err); }
        },
        modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
      });
      rzp.open();
    });
  }

  // PayPal uses its own Buttons (rendered on demand); create_order already made the order id.
  let paypalRendered = false;
  function setupPaypalIfNeeded() {
    const mount = document.getElementById('paypal-buttons');
    if (!mount) return;
    const usePaypal = provider === 'paypal' && hasPaypal && window.paypal;
    mount.hidden = !usePaypal;
    // The submit button drives Razorpay; PayPal renders its own button, so hide submit for PayPal.
    if (submit) submit.style.display = usePaypal ? 'none' : '';
  }
```

For PayPal, the cleanest flow with the JS SDK is to let PayPal Buttons create+capture. Replace the abstract `runPaypal` with a button-render approach. Add:
```js
  function renderPaypalButtons() {
    const mount = document.getElementById('paypal-buttons');
    if (!mount || !window.paypal || mount.dataset.rendered) return;
    mount.dataset.rendered = '1';
    window.paypal.Buttons({
      createOrder: async () => {
        const email = form.querySelector('input[name=email]').value.trim();
        const customVal = parseInt(form.querySelector('input[name=custom]').value, 10);
        if (customVal > 0) selectedAmt = customVal;
        const order = await postJSON('api/create_order.php', { amount: selectedAmt, email: email, currency: curCode });
        return order.order_id;
      },
      onApprove: async (data) => {
        const email = form.querySelector('input[name=email]').value.trim();
        const v = await postJSON('api/paypal_capture.php', { order_id: data.orderID, email: email });
        if (v.repo_url) return go(v.repo_url);
        setMsg('Thank you so much! ☕ The repo link is on its way to your inbox.', 'ok');
      },
      onError: () => setMsg('PayPal had a problem. Try again?', 'err'),
    }).render('#paypal-buttons');
  }
```
And call `renderPaypalButtons()` inside `setupPaypalIfNeeded()` when `usePaypal` is true:
```js
    if (usePaypal) renderPaypalButtons();
```

Update the form submit handler: it should only drive Razorpay (PayPal is button-driven). Change the payment branch in the submit handler:
```js
      if (selectedAmt > 0 && provider === 'razorpay' && hasRzp) {
        setMsg('Opening secure checkout…');
        const v = await runPayment(email);
        if (v.repo_url) return go(v.repo_url);
        setMsg('Thank you so much! ☕ The repo link is on its way to your inbox.', 'ok');
        return;
      }
      if (selectedAmt > 0 && provider === 'paypal') {
        setMsg('Use the PayPal button above to complete your tip ☕', 'ok');
        submit.disabled = false; return;
      }
```

Call `renderCurrencyUI()` + `setupPaypalIfNeeded()` when the modal opens. In `openFunnel`, after `modal.hidden = false;`:
```js
    renderCurrencyUI();
    setupPaypalIfNeeded();
```
And replace the old `#tip-row .tip` click binding (the server buttons no longer exist) — the renderer binds clicks itself, so delete:
```js
  document.querySelectorAll('#tip-row .tip').forEach((b) =>
    b.addEventListener('click', () => selectAmount(b.dataset.amt)));
```

- [ ] **Step 3: Rewrite the support-page tip grid** (`support.php`) to render from the currency map via JS

Replace the PHP preset loop:
```php
    <div class="tip-grid" id="support-tips">
      <?php foreach ($rzp['preset_amounts'] as $amt): ?>
        <button class="tip" type="button" data-amt="<?= (int)$amt ?>">₹<?= (int)$amt ?></button>
      <?php endforeach; ?>
      <button class="tip" type="button" data-amt="0">Custom</button>
    </div>
```
with a JS-populated grid (currency-aware), and drop the now-unused `$rzp` line at top of support.php:
```php
    <div class="tip-grid" id="support-tips" data-funnel-tips></div>
```
And add to the support.php inline `<script>` (after the eyes block), populate from the map and open the funnel on click:
```js
    (function () {
      var grid = document.getElementById('support-tips');
      var CUR = (window.COSMO && window.COSMO.currencies) || {};
      var cur = (window.COSMO && window.COSMO.currency) || 'USD';
      var m = CUR[cur] || { symbol: '', presets: [] };
      if (grid) {
        m.presets.forEach(function (amt) {
          var b = document.createElement('button');
          b.className = 'tip'; b.type = 'button'; b.dataset.amt = String(amt);
          b.textContent = m.symbol + amt;
          b.addEventListener('click', function () { if (window.openFunnel) window.openFunnel(amt); });
          grid.appendChild(b);
        });
        var c = document.createElement('button');
        c.className = 'tip'; c.type = 'button'; c.dataset.amt = '0'; c.textContent = 'Custom';
        c.addEventListener('click', function () { if (window.openFunnel) window.openFunnel(); });
        grid.appendChild(c);
      }
    })();
```
Remove the now-unused `$rzp = (cosmo_config()...)` line (line 6) from support.php.

- [ ] **Step 4: Lint + JS syntax**

Run: `php -l support.php && php -l includes/footer.php && node --check assets/js/funnel.js`
Expected: all clean.

- [ ] **Step 5: Commit**
```bash
git add cosmo-site/assets/js/funnel.js cosmo-site/support.php cosmo-site/includes/footer.php
git commit -m "feat(site): currency-aware presets, currency picker, PayPal Buttons branch"
```

---

## Task 16: Browser verification (Playwright) — currency switching renders correctly

**Files:**
- (no code) — verification only; artifacts to `.artifacts/playwright/`

- [ ] **Step 1: Start the PHP server** (from repo root)

Run: `php -S 127.0.0.1:8094 -t cosmo-site` (background it)
Expected: serves; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8094/support.php` → `200`.

- [ ] **Step 2: Seed a fake config so currencies render** — without `.env`, `cosmo_config()` returns null and `window.COSMO.currencies` is empty. Create a throwaway `.env` for local testing **only if absent** (do not overwrite a real one):

Run:
```bash
test -f cosmo-site/.env || cp cosmo-site/.env.example cosmo-site/.env
```
Then ensure `PAYMENT_CURRENCIES=INR,USD,EUR,GBP` is set (it is, by default in `.env.example`).

- [ ] **Step 3: Verify the picker + presets** (Playwright; desktop)

Navigate to `http://127.0.0.1:8094/support.php`, open the funnel (click a tip), and assert via `browser_evaluate`:
```js
() => {
  const sel = document.getElementById('cur-select');
  const tips = [...document.querySelectorAll('#tip-row .tip')].map(b => b.textContent);
  return { hasSelect: !!sel, options: sel ? [...sel.options].map(o=>o.value) : [], tips };
}
```
Expected: `hasSelect:true`, `options` ⊇ enabled currencies, `tips` show the active currency's symbol (e.g. `["$3","$5","$10","$25"]` for USD or `["₹49",...]` for INR).

- [ ] **Step 4: Switch currency → presets re-render** (Playwright): select `INR` in `#cur-select`, re-run the evaluate; assert tips now show `₹` amounts. Screenshot to `.artifacts/playwright/pay-currency-switch.png` and read it back to confirm visually.

- [ ] **Step 5: Clean up** — stop the server, remove the throwaway `.env` if you created it (`git status` must show no `.env`), remove `.playwright-mcp/`.

```bash
rm -rf cosmo-site/.playwright-mcp .playwright-mcp
# if you created a throwaway .env: rm cosmo-site/.env   (NEVER commit .env)
```

- [ ] **Step 6: Commit** (no code; nothing to commit unless screenshots are versioned — they're gitignored. Skip.)

---

## Task 17: End-to-end manual test checklist (test/sandbox keys)

**Files:**
- (no code) — a checklist to run before going live; record results in the PR/commit message.

- [ ] **Step 1: Apply the DB migration** on the test database:
`mysql <db> < cosmo-site/sql/migrations/2026-06-10-multicurrency-payments.sql`
Verify: `SHOW COLUMNS FROM donations;` includes `processor`, `country`, `ip_hash`; `SHOW TABLES;` includes `webhook_events`, `rate_limits`.

- [ ] **Step 2: Razorpay (Test mode), India/INR:** set geo to India (or force `currency:'INR'` via the picker), tip ₹49 with a Razorpay test card → repo unlocks; `donations` row `status='paid'`, `processor='razorpay'`, `currency='INR'`, `amount_paise=4900`.

- [ ] **Step 3: PayPal (Sandbox), USD:** pick USD, tip $3 via the PayPal button with a sandbox buyer → capture succeeds, repo unlocks; row `status='paid'`, `processor='paypal'`, `currency='USD'`, `amount_paise=300`.

- [ ] **Step 4: Floor enforcement:** attempt $2 (below USD floor) → `create_order.php` returns 422 "Pick at least $3."; attempt ₹10 with INR → 422 "Pick at least ₹49.".

- [ ] **Step 5: Webhooks:** from each dashboard, send a test `payment.captured` (Razorpay) / `PAYMENT.CAPTURE.COMPLETED` (PayPal) to `/api/webhook_razorpay.php` and `/api/webhook_paypal.php`. Verify: 200 response, row flips/stays `paid`, a `webhook_events` row exists; re-send the same event → still 200, no duplicate effect (dedup works); tamper the signature/headers → 400.

- [ ] **Step 6: Rate-limit + origin:** fire 13 rapid `create_order.php` POSTs from one IP → the 13th returns 429. POST with a foreign `Origin` header → 403.

- [ ] **Step 7: Confirm the build-time items** from the spec §8: PayPal micro-payments rate requested; USD/EUR/GBP behavior in sandbox; `X-Forwarded-For` gives a sane `client_ip()` on Hostinger; webhook IDs/secrets set in `.env`.

- [ ] **Step 8: Commit the checklist results** (in the merge/PR description, not a code file).

---

## Self-Review

**Spec coverage:**
- Server-authoritative currency (override→geo→default) → Task 2 (`resolve_currency`) + Task 10 (used in `create_order`). ✓
- Per-region floors (₹49 / $3·€3·£3) → Task 2 (`COSMO_CURRENCIES`) + Task 10 (enforcement) + Task 17 (boundary test). ✓
- Processor routing INR→Razorpay, foreign→PayPal, swappable → Task 2 (`processor_for_currency`) + Task 9 (`FOREIGN_PROCESSOR`) + Task 6 (registry). ✓
- geo countryCode → Task 3. ✓
- Rate-limit / same-origin / ip_hash → Task 4 + applied in Tasks 10–13. ✓
- DB processor/country/ip_hash + webhook_events + rate_limits → Task 5. ✓
- Razorpay create/verify/webhook via adapter → Task 7 + 10 + 11 + 13. ✓
- PayPal create/capture/webhook via adapter → Task 8 + 10 + 12 + 13. ✓
- Webhook idempotency (dedup + status guard) → Task 13 (`webhook_apply`). ✓
- Amount/currency cross-check → Task 12 (capture) + parse-level in Task 13. ✓
- UI: per-currency presets, picker, provider branch, real contact → Task 14 + 15 (PayPal collects contact in its own flow; Razorpay prefills email). ✓
- Config/.env → Task 9. ✓

**Placeholder scan:** No "TBD/TODO". Two spots intentionally show a first cut then a corrected version (Task 4 `rate_window_start` expected value; Task 15 `setCurrency`) — the engineer keeps the corrected line. The Task 14 `$ppCurs` is explicitly dropped in the simplified block. Resolved inline.

**Type/name consistency:** `createOrder(int,string,string,string):array` returning `['order_id','client']` is consistent across the interface (Task 6), both adapters (7/8), and `create_order.php` (10). `parseWebhookEvent` shape `['status','order_id','payment_id','amount_minor','currency']` is consistent across adapters (7/8) and `webhook_apply` (13). `processor_for_currency($cur,$foreign)`, `resolve_currency($override,$geo,$enabled,$default)`, `to_minor`, `currency_meta`, `public_currency_map` names match between Task 2 and all callers. `donations.razorpay_order_id` reused as the generic provider order id (documented in Task 10) — consistent in 10/11/12/13. `client_ip`/`ip_hash`/`rate_limit`/`require_same_origin`/`request_headers_lower`/`webhook_apply` defined in Task 4/13, used in 10–13. ✓

**Gap fixed during review:** added the amount/currency cross-check to the PayPal capture (Task 12) to match the spec's tamper mitigation; ensured `verify_payment` and `webhook_apply` both use status-guarded idempotent updates so the two confirmation paths can't fight.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-10-multicurrency-payments.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, spec + code-quality review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session via executing-plans, batch with checkpoints.

Which approach?
