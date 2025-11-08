# TrancheReady — CSV in → Signed ZIP out

Dark, calm enterprise UI. Paywall + Stripe Checkout, magic-link team seats, explainable risk, monitoring cases, signed evidence pack, and verify links.

## 1) Deploy on Render
- **Create Web Service** → connect this repo.
- **Build Command:** `npm ci`
- **Start Command:** `npm start`
- **Node:** 18–22
- Optional: set `BUILD_ID` to any string for provenance (else random).

## 2) Configure domain
- Render → **Settings → Custom Domains** → add `trancheready.com` and `www.trancheready.com`.
- In Namecheap → set the DNS **exactly** as Render shows.
- Back in Render → **Verify** (green check) → HTTPS will auto-enable.

## 3) Enable payments (Stripe)
Add these 4 env vars in **Render → Environment** (use test keys while testing):
- `STRIPE_SECRET_KEY=...`
- `STRIPE_PRICE_ID_STARTER=...`
- `STRIPE_PRICE_ID_TEAM=...`
- `COOKIE_SECRET=<long-random>`

> Without Stripe keys, marketing pages still work. Paywall requires Stripe to unlock `/app`.

## 4) Use the app
- Visit `/pricing` → buy **Starter** (one-off) or **Team** (subscription).
- After Stripe returns to `/billing/return`, you’re redirected to `/app` with a 30-day cookie.
- **Upload** Clients.csv + Transactions.csv → Validate → Generate → Download ZIP → Share verify link.

## 5) Invite your team (no DB)
- Owner goes to `/team` → **Create invite link** → send to teammate.
- Teammate clicks → gets a seat cookie (30 days) → can use `/app`.

## Notes
- Uploads are processed **in memory**; verify tokens expire after **60 mins**.
- Evidence ZIP contains `clients.json`, `transactions.json`, `cases.json`, `program.html`, `manifest.json` with **SHA-256** and **Build ID**.
