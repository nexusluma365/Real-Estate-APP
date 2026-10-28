# RentReady Integration Guide (Netlify)

The front end runs end-to-end in **mock mode**. In production it calls one Netlify Function that serves every
`/api/*` route, backed by a Turso (libSQL/SQLite) database and a private Netlify Blobs store for product files.

## 0. Modes

| `VITE_FUNNEL_MODE` | Behaviour |
|---|---|
| `mock` (default) | Leads, payments, entitlements and files are simulated in the browser. A blue banner says so. Mock-only code (`grantMockEntitlement`) throws outside mock mode. |
| `production` | Every service calls the API. Missing secrets/bindings return **501 not_configured** and the UI shows an error state. Nothing is fabricated. |

Mock data lives in `localStorage` keys prefixed `rr.` (reset from **/access → Development tools**).

## 1. Architecture map

```
src/lib/                 browser services (one per concern) — never hold secrets
  api.ts                 fetch wrapper (credentials: include → HttpOnly session cookie)
  leadService.ts  paymentService.ts  entitlementService.ts  fileService.ts  lifecycle.ts  analytics.ts …
netlify/
  functions/api.mts      ONE function at /api/*: routing, origin check, security headers, error handling
  functions/abandoned-checkouts.mts   Scheduled Function, every 15 min
  lib/_lib.ts            Stripe REST, signed session cookie, webhook signature, entitlements, lifecycle → ESP
  lib/platform.ts        Netlify bindings: env vars, Turso database, Netlify Blobs file store
  lib/api/**             one handler per route ({ request, env } → Response)
  lib/jobs/abandoned.ts  abandoned-checkout detection
schema.sql               database tables (apply once to Turso)
netlify.toml             build + functions config;  public/_headers, public/_redirects
tests/                   npm test — unit tests + end-to-end API test on a real SQLite database
```

| Client call | Method & path | Request | Response |
|---|---|---|---|
| `captureLead` | `POST /api/leads` | `{first_name,email,email_consent,consent_basis,consent_text,lead_source,product_interest,qualification?,attribution,turnstile_token?}` | `{lead_id}` + `Set-Cookie` |
| `createCustomer` | `POST /api/payments/customer` | `{lead_id}` (server trusts the cookie) | `{customer_id}` |
| `createPaymentIntent` | `POST /api/payments/intent` + `Idempotency-Key` | `{product:'guide'\|'creditready'\|'upgrade'}` | `{payment_intent_id,client_secret,amount_cents}` (409 if already owned / not eligible) |
| `verifyPaymentServerSide` | `POST /api/payments/verify` | `{payment_intent_id,product}` | `{verified,order?,products[]}` |
| `savePaymentMethodForUpsell` | `POST /api/payments/save-method` | `{payment_intent_id}` | `{saved}` |
| `chargeUpsell` | `POST /api/upsell/charge` + `Idempotency-Key` | `{product:'playbook'}` | `{status:'succeeded'\|'requires_action'\|'declined'\|'error', …}` |
| `fetchEntitlements` | `GET /api/entitlements` | — | `{customer_id?,first_name?,products[]}` |
| `requestAccessLink` | `POST /api/access/link` | `{email}` | `{sent:true}` (always) |
| (email link) | `GET /api/access/verify?token=` | — | 302 → `/access` + session cookie |
| `getDownloadUrl` | `GET /api/files?key=` | — | file stream, or 302 to the private video URL |
| `emitLifecycle` | `POST /api/lifecycle` | `{event,at,data?}` | `{ok}` |
| `saveAssessment` | `PUT /api/assessment` | `{answers,index,completedAt?}` | `{ok}` |
| analytics beacon | `POST /api/events` | allow-listed event payload | 202 |
| ESP → us | `POST /api/esp/unsubscribe` (Bearer `ESP_WEBHOOK_SECRET`) | `{email}` | `{ok}` |
| /admin | `GET /api/admin/metrics?days=` (Bearer `ADMIN_TOKEN`) | — | aggregate counts only |

## 2. Deploy on Netlify

1. **Database (Turso):** create a database, then `turso db shell <db> < schema.sql`. Copy the URL and an auth token.
2. **Netlify site:** connect the GitHub repo. Build settings come from `netlify.toml` (`npm run build` → `dist`, functions in `netlify/functions`, Node 20).
3. **Environment variables:** everything in `.env.example`. Mark secrets as *Secret*. `VITE_*` values are public and baked into the build, so set `VITE_FUNNEL_MODE=production` and **redeploy** after changing any of them.
4. **Product files:** `netlify blobs:set product-files creditready/dispute-letter-templates.zip --input ./dispute-letter-templates.zip`
   (keys in `src/config/resources.ts`). The video guide is not a file: set `VIDEO_GUIDE_URL` to its private hosted URL.
5. **Stripe webhook:** `https://<site>/api/webhooks/stripe` — `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`.
6. **Scheduled function:** deploys automatically; check *Logs → Functions → abandoned-checkouts*.

## 3. Lead capture
* Client: `src/components/LeadForm.tsx` (used by `/start`, inline checkout, `/checklist`) → `captureLead()`.
* Server: `netlify/lib/api/leads.ts` — validation, optional Turnstile, upsert by email (later answers fill in, never wipe), consent basis/text stored, session cookie.

## 4. Stripe
* Publishable key → `VITE_STRIPE_PUBLISHABLE_KEY`; secret key → `STRIPE_SECRET_KEY` (server only).
* Client: `src/pages/Checkout.tsx` mounts the Address + Payment Elements and calls `stripe.confirmPayment({ redirect: 'if_required' })`.
* Server: `payments/intent.ts` sets the amount from `PRICES` and enforces `purchaseAllowed()` (no re-buying; the $32 upgrade only for book owners). `payments/verify.ts` checks status, amount, currency, customer and `metadata.product` before granting.

## 5. Saved PaymentMethod & one-click upsell
* Consent copy sits above the checkout CTA. Bundle and upgrade PaymentIntents use `setup_future_usage: 'off_session'`.
* `upsell/charge.ts` is the **only** code that charges the saved card, called only from the upsell accept button, with an Idempotency-Key. `requires_action` is completed by a second explicit click (`stripe.handleNextAction`).

## 6. Webhook
* `webhooks/stripe.ts`: signature verified (HMAC-SHA256, 5-minute tolerance, constant-time compare); events de-duplicated via `webhook_events`.
* Source of truth for entitlements; records `purchase_completed`, `payment_failed` and `refund_processed` (full refunds revoke access; partial refunds don't).

## 7. Entitlements & protected routes
* `GET /api/entitlements` decides access; `src/components/Guards.tsx` only reflects it. Client state never grants access, and `/api/files` re-checks ownership on every request.
* Returning customers: `/api/access/link` stores a hashed single-use 30-minute token and emits `access_link_requested`; the ESP emails `data.link`; `/api/access/verify` sets the session.

## 8. Email (ESP)
* Every lifecycle fact is stored once (`lifecycle_events`, unique per lead+event+ref) and POSTed to `ESP_WEBHOOK_URL` with `X-RentReady-Signature` (HMAC-SHA256 of the raw body, hex) and `marketing_allowed`.
* Flows, timing, exit rules and copy: `EMAIL_SEQUENCES.md` and `EMAIL_FLOWS` in `src/lib/lifecycle.ts`.

## 9. Assessment & game plan
* Questions: `src/config/assessment.ts`. Rules: `src/lib/gameplan.ts → buildGamePlan()`. Language: STRONG / REVIEW / NEEDS ATTENTION only; never approved/denied/guaranteed.

## 10. Analytics & ads
* `track()` → GTM `dataLayer`, GA4 (`VITE_GA4_MEASUREMENT_ID`), optional Meta Pixel, and `/api/events` (stored for `/admin`).
* Purchases go only through `trackPurchase()` — verified amount, one report per transaction id.
* Google Ads: `VITE_GOOGLE_ADS_ID` + labels. For accuracy, also upload server-side conversions from the webhook using the stored `gclid`.

## 11. Netlify hardening
* `public/_headers` — HSTS, CSP (Stripe, GTM, Turnstile, Meta, Google Fonts), frame-ancestors none, nosniff.
* `public/_redirects` — SPA fallback; `/api/*` is served by the function (its `path` config takes precedence).
* Add rate limits (Netlify rate-limit rules or a WAF) on `/api/leads`, `/api/payments/*`, `/api/upsell/*`, `/api/access/link`.

## 12. Security checklist before launch
- [ ] `VITE_FUNNEL_MODE=production` and no mock banner visible
- [ ] Only the `pk_` key in any `VITE_` var; `sk_`, `whsec_`, `SESSION_SECRET`, `TURSO_AUTH_TOKEN`, `ADMIN_TOKEN` marked Secret
- [ ] Webhook live and verified (`stripe trigger payment_intent.succeeded`)
- [ ] Fresh browser: `/welcome`, `/gameplan`, `/access` show locked/sign-in
- [ ] `/api/files` refuses non-owners; video URL never appears in page source
- [ ] Upsell charges only after the click; double-click creates one charge
- [ ] Support email, privacy and terms URLs set; legal review of disclaimer, consent copy and FAQ
