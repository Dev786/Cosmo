# Cosmo Marketing Website — Design Spec

**Goal:** A PHP/MySQL marketing site for Cosmo (the desktop AI companion), hosted on Hostinger, that showcases the product, captures emails before handing out the GitHub repo URL, and accepts optional "buy me a coffee" tips via Razorpay.

**Stack:** Hostinger shared hosting → PHP 8.x + MySQL, plain HTML/CSS/vanilla JS frontend (no framework, no build step). Deploy by uploading `cosmo-site/` to `public_html`.

**Brand:** Name = **Cosmo**. Visual hook = the real animated eyes, recreated in-browser from the renderer pack spec (dark `#1e1e2e` circles, white pupils, eyelid-mask blink, mood states, cursor-follow gaze). Accent `#4a9eff`, pink `#ff6b8a`, glassmorphism, friendly rounded type (Quicksand headings + Inter body).

---

## Modules (build order)

### 1. Marketing frontend
Pages: **Home** (hero with live interactive eyes + value prop), **Features** (full capability list), **Architecture** (boundaries + data-flow diagram, privacy guarantees), **Demos** (live scripted eyes playthrough + slot for one short clip), **Support** (buy me a coffee).
Shared `header.php`/`footer.php`. Nav carries the **GitHub funnel icon**.

### 2. The GitHub funnel (lead capture + optional tip)
The GitHub icon does NOT link straight to GitHub. On click:
1. Modal opens: **email (required)** + consent checkbox + optional tip buttons (₹99 / ₹199 / ₹499 / custom).
2. `POST /api/subscribe.php` → validate email, store in `leads` (with IP→geo, referrer, consent), dedupe by email.
3. If a tip was chosen → Razorpay Checkout → `POST /api/verify_payment.php` (server-side HMAC-SHA256 signature verify) → record in `donations`.
4. Backend returns `repo_url` (from `config.php`, never in page source) → JS redirects to GitHub.
- `require_payment_for_url` config flag (default **false** = optional nudge). Email is **always** required.
- `repo_url` is a config slot; filled when the repo goes live.

### 3. Analytics + admin
- `includes/track.php` logs each pageview to `visits` (IP, approx country/city via ip-api.com, referrer, path, UA, time) — best-effort, never blocks the page.
- `admin/` password-protected dashboard (session, `password_hash`): visitor log + geo/referrer breakdown, captured emails, tip totals.
- Small cookie/consent notice (IP/geo + email are personal data).

---

## Components / files

```
cosmo-site/
  index.php  features.php  architecture.php  demos.php  support.php
  assets/css/style.css
  assets/js/eyes.js        # CosmoEyes class — faithful port of the renderer pack
  assets/js/demo.js        # scripted mood playthrough for Demos
  assets/js/funnel.js      # GitHub icon → email/coffee modal → subscribe → redirect
  includes/db.php          # PDO + config loader (best-effort)
  includes/geo.php         # IP → country/city (ip-api.com, short timeout)
  includes/track.php       # pageview logger (try/catch no-op on failure)
  includes/header.php  includes/footer.php
  api/subscribe.php        # email gate: validate, store lead, return repo_url
  api/create_order.php     # Razorpay order create
  api/verify_payment.php   # signature verify + record donation
  admin/login.php  admin/index.php  admin/logout.php
  sql/schema.sql           # visits, leads, donations
  config.sample.php        # copy → config.php (gitignored): DB, Razorpay, repo_url, admin hash
  .htaccess                # deny includes/ + config.php, security headers
  DEPLOY.md
```

## Data (MySQL)
- `visits(id, created_at, ip, country, city, referrer, path, user_agent)`
- `leads(id, email UNIQUE, created_at, ip, country, city, referrer, consent)`
- `donations(id, created_at, email, amount_paise, currency, razorpay_order_id, razorpay_payment_id, status)`

## Security / privacy
- Razorpay `key_secret` server-side only (`config.php`, gitignored, `.htaccess`-denied). Signature verified server-side before trusting any payment.
- PDO prepared statements everywhere. `htmlspecialchars` on all admin output (referrer/UA are attacker-controlled).
- Admin password hashed (`password_hash`/`password_verify`), session-gated.
- Pages render even before DB is configured (tracking/funnel degrade gracefully).
- Consent checkbox for email; cookie notice for tracking.

## Out of scope (v1)
Newsletter sending, multi-admin accounts, real download hosting (link to GitHub releases), i18n.
