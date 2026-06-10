# Multi-Currency Tips + Hardened Razorpay — Design

**Date:** 2026-06-10
**Scope:** `cosmo-site/` (PHP marketing site). No changes to the Electron app.
**Goal:** Charge each visitor in their own currency (INR/USD/EUR/GBP) by country, with a per-region price floor, and harden the existing Razorpay tip flow to production-grade security (authoritative webhook, rate-limiting, same-origin, idempotency).

---

## REVISION 2026-06-10 — dual-processor (supersedes the single-Razorpay assumption below)

Razorpay can only charge **foreign-issued** cards after International Payments is approved (KYC + a support request — not instant). To ship foreign payments *now* without that gate, payment splits by processor behind a **swappable foreign-processor adapter**:

- **India / INR → Razorpay** (existing flow; native UPI, lowest fee).
- **Foreign / USD·EUR·GBP → PayPal** (Orders v2 + JS SDK buttons + server capture + signed webhook). No Razorpay intl approval needed.
- **Foreign floor raised to `3`** (USD/EUR/GBP) — PayPal's fixed per-transaction fee makes a $1 tip uneconomical; **INR stays ₹49**.
- **Swappable:** a `FOREIGN_PROCESSOR` config (`paypal` | `razorpay`) selects the foreign adapter. When Razorpay International is later approved, flip it to `razorpay` — no rewrite of the unlock/webhook logic.

This overrides: §2 (charging model + floors), §4.1 (foreign floor `3`; add `processor_for_currency`), §4.4 (create_order routes to the selected processor), §4.6 (TWO webhook endpoints — Razorpay + PayPal — plus a PayPal server-side capture step), §5 (`donations.processor` column). Everything else stands unchanged: currency resolution, per-IP rate-limit, same-origin guard, webhook idempotency, salted `ip_hash`.

**PayPal facts (verified against developer.paypal.com):** Orders v2 `amount.value` is a **decimal string in major units** (`"3.00"`, not minor units); OAuth via `POST /v1/oauth2/token` (Basic `client_id:secret`, `grant_type=client_credentials`); create `POST /v2/checkout/orders` (`intent:CAPTURE`, `PayPal-Request-Id` idempotency header); capture `POST /v2/checkout/orders/{id}/capture`; webhook authenticity via `POST /v1/notifications/verify-webhook-signature` (transmission headers + `webhook_id` → `verification_status:"SUCCESS"`); events `PAYMENT.CAPTURE.COMPLETED` (paid) / `PAYMENT.CAPTURE.DENIED` (failed); bases `api-m.sandbox.paypal.com` (sandbox) / `api-m.paypal.com` (live).

---

## 1. Context — what exists today

The site already has an email-gated GitHub funnel + Razorpay "buy a coffee" tip that can unlock the repo URL.

- **Client:** `assets/js/funnel.js` → `POST api/create_order.php {amount,email}` → opens Razorpay Checkout → on success `POST api/verify_payment.php {razorpay_order_id, razorpay_payment_id, razorpay_signature, email}`.
- **Server:** `api/create_order.php` validates `amount` (₹1–₹1,00,000), calls Razorpay Orders API with the secret (Basic auth), inserts a `donations` row (`status='created'`), returns `{order_id, key_id, amount(paise), currency}`. `api/verify_payment.php` recomputes `HMAC-SHA256(order_id|payment_id, key_secret)` and compares with `hash_equals`, then flips `status='paid'` and returns `repo_url`.
- **Config:** `RAZORPAY_KEY_ID/_SECRET/_WEBHOOK_SECRET`, single `RAZORPAY_CURRENCY=INR`, `RAZORPAY_PRESETS=99,199,499` (`includes/db.php → cosmo_config()['razorpay']`).
- **Geo:** `includes/geo.php → geo_lookup($ip)` returns `{country, city}` (country *name*) via ip-api.com, gated by `GEO_ENABLED`.
- **DB:** `sql/schema.sql` — `donations(id, created_at, email, amount_paise, currency DEFAULT 'INR', razorpay_order_id, razorpay_payment_id, status, …)`.

**Already correct (keep):** amount authoritative server-side; secret never sent to client; timing-safe signature verify; prepared statements; amount bounds.

**Gaps this design closes:**
1. **No webhook** — `RAZORPAY_WEBHOOK_SECRET` exists but there is no handler. If the payer closes the tab after paying, the client never calls `verify_payment.php` and the donation is stuck at `created`. The webhook is Razorpay's authoritative, retried, server-to-server confirmation.
2. **Single hardcoded currency** — no per-country presentment or floors.
3. **No rate-limiting** — order creation can be spammed.
4. **No same-origin/CSRF mitigation** on the JSON POST endpoints.
5. **No idempotency/replay** handling for async confirmations.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Charging model | **A — native presentment.** Charge in the visitor's currency; settle INR. |
| Regions → currency | IN→INR, US→USD, Eurozone→EUR, GB→GBP, **rest-of-world→USD** |
| Floors / presets | INR ₹49 → 49/99/199/499 · USD $1 → 1/3/5/10 · EUR €1 → 1/3/5/10 · GBP £1 → 1/3/5/10 |
| Currency authority | **Server decides** (override∈enabled-set → else geo → else USD); server enforces the floor of the *final* currency |
| Manual override | Yes — a currency `<select>` (IP geo is wrong behind VPNs); server re-validates |
| Settlement | INR (standard Razorpay India account); Razorpay does card-side FX at checkout |

**Verify at build time (Razorpay dashboard / live docs):** exact per-currency minimums (₹49/$1/€1/£1 are expected to clear easily), confirmed settlement currency, and the exact webhook event names available on the account.

---

## 3. Architecture

```
Browser (funnel.js / support.php)
  │  GET page → window.COSMO.currency (resolved) + window.COSMO.currencies (public map)
  │  POST api/create_order.php {amount, email, currency?}      ── same-origin + rate-limit
  │      └─ server: resolve currency (override|geo|default) → enforce floor/max
  │                 → Razorpay Orders API (dynamic currency) → donations row 'created'
  │  Razorpay Checkout (in resolved currency)
  │  POST api/verify_payment.php {order_id, payment_id, signature, email}  ── instant unlock
  │      └─ HMAC verify + cross-check amount/currency → 'paid' → repo_url
  │
Razorpay servers
  └─ POST api/webhook.php  (order.paid / payment.failed)       ── AUTHORITATIVE backstop
         └─ X-Razorpay-Signature verify → idempotent flip 'created'→'paid' (or 'failed')
```

Two confirmation paths: the **client callback** (fast UX, releases the URL immediately) and the **webhook** (authoritative, survives a closed tab, retried by Razorpay). Both are idempotent and converge on the same `donations` row.

---

## 4. Components

### 4.1 `includes/currency.php` (new) — single source of truth

```php
// Pure config + pure functions. No I/O. Not secret — the public subset is exposed to JS.
const CURRENCIES = [
  'INR' => ['symbol'=>'₹', 'minor'=>100, 'floor'=>49, 'max'=>100000, 'presets'=>[49,99,199,499]],
  'USD' => ['symbol'=>'$', 'minor'=>100, 'floor'=>1,  'max'=>1000,   'presets'=>[1,3,5,10]],
  'EUR' => ['symbol'=>'€', 'minor'=>100, 'floor'=>1,  'max'=>1000,   'presets'=>[1,3,5,10]],
  'GBP' => ['symbol'=>'£', 'minor'=>100, 'floor'=>1,  'max'=>1000,   'presets'=>[1,3,5,10]],
];
const EUROZONE = ['AT','BE','HR','CY','EE','FI','FR','DE','GR','IE','IT','LV','LT','LU','MT','NL','PT','SK','SI','ES'];

function currency_for_country(string $iso): string;          // IN→INR, US→USD, GB→GBP, EUROZONE→EUR, else DEFAULT
function resolve_currency(?string $override, string $geoIso, array $enabled, string $default): string;
function currency_meta(string $cur): array;                  // CURRENCIES[cur] (with default fallback)
function public_currency_map(array $enabled): array;          // {cur: {symbol,floor,presets}} for window.COSMO.currencies
function to_minor(int $major, string $cur): int;             // major * minor
```

- `resolve_currency`: `override` is honored **only if** it is in `$enabled`; otherwise `currency_for_country($geoIso)`; otherwise `$default`. Never throws — always returns an enabled currency.
- `$enabled` / `$default` come from `.env` (below) via `cosmo_config()`.

### 4.2 `includes/geo.php` — add ISO country code

- Add `countryCode` to the ip-api `fields` (`status,country,countryCode,city`) and return `'countryCode' => (string)($data['countryCode'] ?? '')`. Existing callers (tracking) keep working — additive only.

### 4.3 `includes/api.php` — shared guards (extend)

Add reusable helpers used by all three endpoints:

```php
function client_ip(): string;                 // X-Forwarded-For first hop (Hostinger) → REMOTE_ADDR
function ip_hash(string $ip): string;          // sha256($ip . IP_SALT) — never store raw IP
function require_same_origin(): void;          // Origin/Referer host must == site_url host (skip if both empty / site_url unset); else 403
function rate_limit(string $action, int $cap, int $windowSec): void;  // fixed-window counter; 429 over cap
```

`rate_limit` uses the new `rate_limits` table: `INSERT … ON DUPLICATE KEY UPDATE hits = hits + 1` keyed on `(ip_hash, action, window_start)`, then reject with 429 if `hits > cap`. Opportunistically `DELETE` rows older than 1 day (1-in-N requests) to keep it small. DB errors are non-fatal (fail-open on infra hiccup, never block a paying user on a logging table).

### 4.4 `api/create_order.php` — multi-currency + hardened

1. `require_post(); require_same_origin(); rate_limit('order', 12, 600);`
2. Config guard (key present, not `REPLACE`).
3. `$cur = resolve_currency($in['currency'] ?? null, geo_lookup(client_ip())['countryCode'] ?? '', $enabled, $default);`
4. `$meta = currency_meta($cur); $amount = (int)$in['amount'];`
5. Validate `$amount >= $meta['floor'] && $amount <= $meta['max']` → else `422` with a currency-aware message (`"Pick at least {symbol}{floor}."`).
6. `$minor = to_minor($amount, $cur);` create Razorpay order with `currency => $cur`, `amount => $minor`.
7. Insert donation with `currency=$cur`, `amount_paise=$minor` (minor units), `country=$geoIso`, `ip_hash`.
8. Return `{ok, order_id, key_id, amount:$minor, currency:$cur}`.

> `receipt` (≤40 chars, must be unique) doubles as Razorpay's idempotency key — duplicate receipts are rejected. The existing random `cosmo_<hex>` is already unique; keep it.

### 4.5 `api/verify_payment.php` — kept + hardened

- Prepend `require_same_origin(); rate_limit('verify', 30, 600);`
- After signature passes, **cross-check**: load the donation row by `razorpay_order_id`; if the order's stored `currency`/`amount_paise` are inconsistent with the request context, log and still proceed only when the signature is valid (signature already binds order+payment). Flip `created→paid` (guard so a webhook that already flipped it isn't downgraded). Return `repo_url`.

### 4.6 `api/webhook.php` (new) — authoritative confirmation

1. Read raw body: `$raw = file_get_contents('php://input');`
2. `$sig = $_SERVER['HTTP_X_RAZORPAY_SIGNATURE'] ?? '';` `$expected = hash_hmac('sha256', $raw, $webhook_secret);` reject `400` unless `hash_equals($expected, $sig)`. **No same-origin/rate-limit here** — caller is Razorpay, auth is the signature.
3. Dedupe: `$eventId = $_SERVER['HTTP_X_RAZORPAY_EVENT_ID'] ?? '';` `INSERT IGNORE INTO webhook_events(event_id,type,received_at)`. If 0 rows affected → already processed → `200` and stop.
4. Parse JSON **only after** the signature passes (docs: "Do not parse or cast the webhook request body" before verifying). Handle:
   - **`payment.captured`** (primary — explicitly documented as available; the authoritative "money received" signal): read `payload.payment.entity` → find the donation by its `order_id`; **cross-check** `amount` + `currency` == the stored row; flip `created→paid`, set `razorpay_payment_id`. Idempotent (status guard). `order.paid`, if also subscribed, is handled identically (keyed by `payload.order.entity.id`).
   - `payment.failed`: flip `created→failed` (never override `paid`).
5. Always `200` once signature + dedupe pass (Razorpay retries non-2xx). Wrap DB work so a transient error returns non-200 → Razorpay retries later.

Dashboard: add webhook URL `https://<site>/api/webhook.php`, subscribe to `order.paid` + `payment.failed` (+ `payment.captured` if used), secret → `RAZORPAY_WEBHOOK_SECRET`.

### 4.7 UI — `support.php`, `footer.php`, `funnel.js`

- **Server-injected (footer.php `window.COSMO`):** `currency` (resolved for this visitor) + `currencies` (public map: symbol/floor/presets). Both derived from geo + config; not secret.
- **support.php:** render preset buttons for the active currency with its symbol; add a `<select id="cur-select">` of enabled currencies (default = resolved). "Custom" field min = active floor.
- **funnel.js:** read `window.COSMO.currency`/`currencies`; render presets in active currency; on `<select>` change, re-render presets from the public map (no server call); send `{amount, email, currency}` to `create_order.php`. Server remains authoritative (re-resolves + re-validates).
- **Real contact required for international (docs gotcha):** Razorpay *fails* international payments sent with a dummy email/phone. Collect a phone number alongside email (or rely on Checkout's own mandatory contact step) and pass real `prefill.email` + `prefill.contact` to Razorpay Checkout — never placeholder values. funnel.js currently collects email only → add a phone field (or leave `prefill.contact` empty so Checkout *requires* the user to enter it; do **not** inject a fake value).

### 4.8 `.env` / config (`includes/db.php`)

```
# Added
PAYMENT_CURRENCIES=INR,USD,EUR,GBP      # enabled set (order = display order)
PAYMENT_DEFAULT_CURRENCY=USD            # rest-of-world fallback
IP_SALT=<random 32+ chars>             # for ip_hash; never raw IPs in DB
# Existing, still used
RAZORPAY_KEY_ID= / RAZORPAY_KEY_SECRET= / RAZORPAY_WEBHOOK_SECRET=
# Superseded by includes/currency.php (kept readable but no longer authoritative)
# RAZORPAY_CURRENCY= / RAZORPAY_PRESETS=
```

`cosmo_config()['razorpay']` gains `enabled_currencies` (parsed list ∩ `CURRENCIES` keys) and `default_currency` (∈ enabled, else first enabled). Floors/presets live in `currency.php`, not `.env` (product config, not secrets).

---

## 5. Data model (`sql/schema.sql` + `sql/migrations/2026-06-10-multicurrency.sql`)

```sql
-- donations: amount_paise now holds MINOR UNITS of `currency` (paise/cents/pence).
ALTER TABLE donations ADD COLUMN country VARCHAR(2) NULL AFTER currency;
ALTER TABLE donations ADD COLUMN ip_hash CHAR(64) NULL AFTER country;

CREATE TABLE IF NOT EXISTS webhook_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id    VARCHAR(64) NOT NULL,
  type        VARCHAR(48) NOT NULL,
  received_at DATETIME    NOT NULL,
  UNIQUE KEY uniq_event (event_id)
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

Migration runs once on the server (plain `ALTER`s; `schema.sql` updated for fresh installs). `donations.currency` already exists (default `'INR'`).

---

## 6. Security summary (threat → mitigation)

| Threat | Mitigation |
|---|---|
| Forged success callback | HMAC-SHA256 signature + `hash_equals` (client + webhook) |
| Tab closed after pay → lost confirmation | **Webhook** flips `created→paid` independently |
| Webhook spoofing | `X-Razorpay-Signature` HMAC over raw body |
| Webhook replay / retries | `webhook_events.event_id UNIQUE` dedupe + status-guarded idempotent updates |
| Amount/currency tampering | Server resolves currency + enforces floor; order amount set server-side; webhook cross-checks payload vs stored row |
| Order-create spam | Per-IP fixed-window `rate_limit` → 429 |
| Cross-site POST | `require_same_origin` (Origin/Referer host == site host) |
| PII (raw IP) at rest | Store `ip_hash` (salted SHA-256), never raw IP |
| Secret leakage | `key_secret`/`webhook_secret` server-only in `.env`; only publishable `key_id` reaches the browser |

---

## 7. Testing plan

- **`currency.php` (pure, CLI asserts):** country→currency table (IN/US/GB/DE/“ZZ”); override honored only when enabled; floor enforcement boundaries (48 reject / 49 accept for INR; 0 reject / 1 accept for USD); `to_minor`.
- **`create_order.php`:** below-floor → 422 (currency-aware msg); over-cap calls → 429; cross-origin Origin → 403; happy path (Razorpay **test** keys) creates an order in each currency and writes the row.
- **`webhook.php`:** valid signature → flips to paid; bad signature → 400; duplicate `event_id` → 200 no-op; amount/currency mismatch → logged, not paid.
- **`verify_payment.php`:** good/bad signature; flips created→paid; doesn't downgrade a webhook-paid row.
- **Manual (Razorpay test mode):** end-to-end with test cards in INR/USD/EUR/GBP — confirm the Checkout modal shows the correct currency/amount and the repo unlocks.
- **Playwright:** support page renders presets per currency; switching `#cur-select` re-renders symbol + amounts; mobile + desktop.

---

## 8. Build-time verifications (do not trust this doc)

1. **Per-currency minimums** — docs state only INR ₹1.00; confirm $1/€1/£1 clear the international-card minimum (expected to, but unverified).
2. **USD/EUR/GBP are activated** for this account (Account & Settings → International payments → International Cards). Docs don't enumerate currencies; "raise a support request" for any not enabled.
3. **Settlement currency = INR** (docs confirm this for Indian businesses) — sanity-check on the dashboard.
4. **Webhook events** to subscribe: `payment.captured` (documented) + `payment.failed`; optionally `order.paid`. Confirm they're available/toggled on.
5. **Hostinger `X-Forwarded-For`** shape, for a correct `client_ip()` (first hop).
6. **Intl real-contact rule** (docs) — verify Checkout collects a real phone; a dummy contact fails the payment.

---

## 9. Out of scope (YAGNI)

Subscriptions/recurring; saved cards; tax/GST invoicing; admin currency analytics breakdown (the existing admin dashboard keeps working — amounts are in minor units of each row's currency); live FX on our side (Razorpay handles card-side conversion); zero-decimal currencies (JPY etc.).
