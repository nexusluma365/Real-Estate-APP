# RentReady Cloudflare R2 Download Email Worker

This Worker sends paid-download emails after the existing Stripe upsell flow
succeeds. It reads lead and entitlement records from Supabase, verifies the
customer unlocked the product, checks the file exists in R2, sends a secure
download link by email, and serves the R2 object only when that signed link is
valid.

## Endpoints

- `POST /send-download` with `{ "leadId": "...", "product": "modern" }`
- `GET /download?token=...`

Valid products are `modern`, `luxury`, `gameplan`, and `creditkit`.

## Cloudflare bindings and secrets

Create an R2 bucket and bind it as `DOWNLOADS` in `wrangler.toml`. This repo
is currently configured for the R2 bucket `realestateproject`.

Required Worker secrets:

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SECRET_KEY
wrangler secret put EMAIL_LINK_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put FROM_EMAIL
wrangler secret put TRIGGER_SECRET
```

Optional vars/secrets:

```bash
wrangler secret put PUBLIC_WORKER_URL
wrangler secret put MODERN_DOWNLOAD_KEY
wrangler secret put LUXURY_DOWNLOAD_KEY
wrangler secret put GAMEPLAN_DOWNLOAD_KEY
wrangler secret put CREDITKIT_DOWNLOAD_KEY
```

Default R2 object keys:

- `RentReady Guide.zip` for Modern
- `RentReady Guide.zip` for Luxury
- `gameplan.pdf`
- `creditkit.pdf`

## Netlify integration

Set these Netlify environment variables so the existing successful-upsell
email trigger forwards to Cloudflare:

```bash
CLOUDFLARE_DOWNLOAD_EMAIL_URL=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/send-download
CLOUDFLARE_DOWNLOAD_EMAIL_SECRET=same_value_as_TRIGGER_SECRET
```

The frontend already calls `/.netlify/functions/email-asset` only after the
Modern/Luxury upsell returns `succeeded`. If the card declines, that endpoint
is not called.
