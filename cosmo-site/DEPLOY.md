# Deploying the Cosmo site to Hostinger

Plain PHP + MySQL, no build step. You upload the folder and fill in one `.env`.

## 1. Create the MySQL database
hPanel → **Databases → MySQL Databases**. Create a database + user (Hostinger
shows the host, e.g. `srvNNN.hstgr.io`). Note **host, name, user, password**.

## 2. Import the schema
hPanel → **phpMyAdmin** → select your DB → **Import** → upload `sql/schema.sql` → Go.
(Creates the `visits`, `leads`, `donations` tables.)

## 3. Upload the site
Upload **everything inside `cosmo-site/`** into `public_html/` — via hPanel
**File Manager** (drag-drop a zip, then Extract) or FTP.

> **Important:** `.htaccess`, `.env`, and `.env.example` start with a dot. In File
> Manager enable **Settings → Show hidden files** so they upload, or they'll be
> silently skipped and the site won't protect its secrets.

## 4. Create `.env`
Copy `.env.example` to `.env` (File Manager → right-click → Copy/Rename) and fill in:

| Key | What |
|---|---|
| `DB_HOST` / `DB_NAME` / `DB_USER` / `DB_PASS` | from step 1 |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | dashboard.razorpay.com → API Keys (start in **Test mode**) |
| `ADMIN_PASSWORD_HASH` | see step 5 |
| `REPO_URL` | your GitHub repo — **leave blank until it's public** |
| `SITE_URL` | `https://your-domain.com` |

`.env` is the ONLY place secrets live — no key is written into any `.php`/`.html`,
and `.htaccess` blocks `.env` from ever being served.

## 5. Set the admin password
Generate a bcrypt hash and paste it into `ADMIN_PASSWORD_HASH`. From any machine
with PHP, or Hostinger's **Tools → PHP**:
```
php -r "echo password_hash('your-admin-password', PASSWORD_DEFAULT), PHP_EOL;"
```

## 6. Test it
- Visit `https://your-domain.com/` — pages should render and the eyes blink.
- Click **Get Cosmo**, enter an email → it should land in the `leads` table.
- Visit `https://your-domain.com/admin/` → sign in → you'll see visits, emails, tips.

## 7. Razorpay (when you're ready)
1. Test mode first: `RAZORPAY_KEY_ID=rzp_test_…` + its secret. Use a test card to
   confirm a tip flows end-to-end and shows up as **paid** in `/admin`.
2. Go live: swap in `rzp_live_…` keys. (Optional) add a webhook pointing at
   `/api/` and set `RAZORPAY_WEBHOOK_SECRET`.

## 8. Go public
When the GitHub repo is live, set `REPO_URL` in `.env`. The funnel immediately
starts redirecting visitors there after they enter their email. Until then it
shows "you're on the list".

## Notes
- The marketing pages render even before `.env`/DB exist — only the funnel,
  payments, and admin need them. Tracking fails silent.
- `setup.sh` lives at the **app repo root** (it ships with the source, not this
  site folder). The Setup page documents `git clone … && ./setup.sh` plus a
  GitHub-raw `curl … | bash` one-liner.
- Local testing: `docker compose up -d --build` from the repo root → the site at
  **http://localhost:8090** (MySQL on 3309). See `docker-compose.yml`.
