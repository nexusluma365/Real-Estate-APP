# RentReady — Launch Checklist & Integration Status

**Overall: NOT yet production-ready.** The code is complete and tested in mock mode. Payments, fulfillment,
email and analytics still need real credentials and a live test-mode run (see §1).

## 1 · Integration status

| Integration | Status | Notes |
|---|---|---|
| Production build / TypeScript (app + API) | **VERIFIED** | `npm run check` (typecheck app + `netlify/`, tests, build) passes |
| Netlify runtime (local) | **VERIFIED** | `netlify serve` (CLI 17.38.1) built the site + both functions; pages load, `/api/*` reaches the function (not the SPA fallback), security headers present, unconfigured endpoints return 501 |
| Critical-path tests | **VERIFIED** | `npm test`: 18/18 — 13 unit (pricing, eligibility, webhook, purchase de-dupe, quiz, copy) + 5 end-to-end through the real router on a real SQLite DB (full purchase journey, upgrade rules, files/video, upsell, refund, abandoned checkout, unsubscribe, admin metrics) |
| Mock-mode funnel UI (landing, finder, options, checkout, checklist, upsell, welcome, access) | **VERIFIED** (rendered) | Rendered at 1440px and a true 390px width; post-purchase pages rendered with seeded guide and Kit entitlements. Clicks were **not** automated (no browser driver available). Click through once by hand: `npm run dev` |
| Stripe PaymentIntents, Payment/Address Elements, verify, upsell charge | **CONFIGURATION REQUIRED** | Needs `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `SUPABASE_DB_URL`, `SESSION_SECRET`. Not run against Stripe test mode |
| Stripe webhook (entitlements, payment_failed, refunds) | **CONFIGURATION REQUIRED** | Logic unit-tested with signed payloads; needs `STRIPE_WEBHOOK_SECRET` + endpoint in Stripe |
| Book → Digital Bundle upgrade ($32) | **CONFIGURATION REQUIRED** | Server-enforced eligibility; tested in mock + unit tests |
| Lead capture + qualification storage | **CONFIGURATION REQUIRED** | Needs a Supabase PostgreSQL project with `schema.sql` applied |
| Lifecycle → ESP | **CONFIGURATION REQUIRED** | `ESP_WEBHOOK_URL`, `ESP_WEBHOOK_SECRET`; build flows from `EMAIL_SEQUENCES.md`. **Until configured, no email is sent**, including the receipt/access email the site mentions |
| Abandoned-checkout detection | **CONFIGURATION REQUIRED** | Netlify Scheduled Function (every 15 min) — needs only the database |
| Magic-link sign-in | **CONFIGURATION REQUIRED** | Implemented: single-use 30-min hashed token → `access_link_requested` → ESP emails `data.link` → `/api/access/verify` sets the session. Needs ESP + the `access_link` flow |
| Product file delivery (Cloudflare R2) | **CONFIGURATION REQUIRED** | Configure a private R2 bucket and read-only token; upload the allow-listed product objects. The API issues five-minute presigned URLs after checking entitlement. |
| GA4 / Google Ads | **CONFIGURATION REQUIRED** | `VITE_GA4_MEASUREMENT_ID`, `VITE_GOOGLE_ADS_ID` + labels |
| Meta Pixel | **CONFIGURATION REQUIRED** | `VITE_META_PIXEL_ID` (optional) |
| Admin dashboard `/admin` | **CONFIGURATION REQUIRED** | `ADMIN_TOKEN` + database. Mock mode shows labelled sample data only |
| Turnstile bot check | **CONFIGURATION REQUIRED** | Server verifies when the secret is set; the client widget is still a placeholder (pre-existing) |

## 2 · Business decisions / content to confirm before launch

1. **Video guide hosting:** host the step-by-step video guide privately (Vimeo private/domain-restricted, Wistia,
   etc.) and set `VIDEO_GUIDE_URL` (server secret). Entitled Bundle owners are redirected to it from their access page.
2. **Product files:** configure `CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, and `CLOUDFLARE_R2_SECRET_ACCESS_KEY` in Netlify. Set `CLOUDFLARE_R2_BUCKET=creditrepairbusiness`, then upload `CREDIT REPAIR TOOLKIT™.zip` to the bucket root; see `INTEGRATION_GUIDE.md`.
2b. **Bundle artwork typo:** the template box in `design/Rent Ready Digital Bundle.png` reads "ACTIVEA" above the 20. Fix the
   artwork, then re-run the WebP export (`src/assets/rentready-digital-bundle*.webp`).
3. **Refund policy:** the site promises a `VITE_MONEY_BACK_DAYS` (default 30) day full refund. Publish matching
   terms (`VITE_TERMS_URL`) and make sure support can process refunds. Set it to 0 to hide every mention.
4. **Shipping:** both products now ship a physical book. Set `VITE_PHYSICAL_DELIVERY_NOTE` (e.g. "Ships in 2–3 business
   days") and make sure every paid PaymentIntent with a shipping address reaches your fulfillment process.
5. Set a real `VITE_SUPPORT_EMAIL`, `VITE_PRIVACY_URL`, `VITE_TERMS_URL` and `VITE_PHYSICAL_DELIVERY_NOTE`.

## 3 · Deployment (Netlify) — full steps in `INTEGRATION_GUIDE.md` §2

1. Supabase: the RentReady migration is already applied to the existing `Real-Estate-APP` project. Add its Transaction Pooler connection string as the secret `SUPABASE_DB_URL`.
2. Source: Netlify deploys from `nexusluma365/Real-Estate-APP` (`main`), but this workspace has no Git metadata. Transfer these local changes to that repository before deploying.
3. Netlify variables: set every required value in `.env.example`; mark server credentials as secrets. Production builds default to `VITE_FUNNEL_MODE=production` in `netlify.toml`; public `VITE_*` values are baked into the next deploy.
4. Configure the private Cloudflare R2 bucket `creditrepairbusiness`, its read-only credentials, and upload every required object key from `src/config/resources.ts`. The confirmed Bundle flow displays the ZIP download immediately before the optional Playbook offer. Set `VIDEO_GUIDE_URL` for the separately hosted video.
5. Stripe webhook → `https://<site>/api/webhooks/stripe`.
6. Configure the ESP webhook/secrets and complete its transactional/access-link flows in addition to marketing email flows.
7. Rollback: Netlify → Deploys → publish the previous deploy. The untouched original project is at `../rentready-baseline-2026-10-28/`.

## 4 · Stripe checklist
- [ ] Test keys first: `pk_test_…` / `sk_test_…`
- [ ] Webhook → `https://<domain>/api/webhooks/stripe`: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
- [ ] Test cards: 4242… (success), 4000 0000 0000 9995 (decline), 4000 0027 6000 3184 (3DS)
- [ ] Book $47.99 → shipping address on the PI → `/welcome` · Digital Bundle $79.99 → shipping address on the PI → upsell → letters/video open
- [ ] Upsell accept ($100 off-session), decline, 3DS "Confirm with my bank"
- [ ] Book owner → `/checkout?product=upgrade` charges $32, asks for no address, grants the Bundle; `/checkout` never charges them $79.99
- [ ] Double-click Pay → one charge · reload `/welcome` → one purchase event
- [ ] Full refund in Dashboard → access revoked + `refund_processed` · partial refund → access kept
- [ ] Switch to live keys only after all of the above

## 5 · Email checklist
- [ ] ESP webhook receives the events; verify `X-RentReady-Signature` (HMAC-SHA256, hex, raw body)
- [ ] Build the flows in `EMAIL_SEQUENCES.md` with their delays and exit conditions
- [ ] Marketing flows gated on `marketing_allowed`; transactional mail always sent
- [ ] ESP unsubscribe webhook → `POST /api/esp/unsubscribe` (Bearer `ESP_WEBHOOK_SECRET`)
- [ ] Sender domain SPF/DKIM/DMARC; physical address in the footer (CAN-SPAM)

## 6 · Google Ads & Meta checklist
- [ ] GA4: mark `purchase` and `generate_lead` as key events. Ecommerce events already carry value, currency, transaction_id and items
- [ ] Google Ads: create Lead / Purchase / Upsell conversions and paste the labels. Turn on enhanced conversions only through Google's own tag settings (no PII is sent from this code)
- [ ] Meta: Pixel id → `VITE_META_PIXEL_ID`. For Conversions API, send `Purchase` server-side with `event_id` = the Stripe PaymentIntent id (the browser already uses it, so Meta de-duplicates)
- [ ] **Policy (verify current rules before launching campaigns):** housing- and credit-related ads face special
      restrictions. On Meta, declare the **Housing** (and, where applicable, **Financial products & services**) Special
      Ad Category, which limits age, gender, ZIP and audience targeting. Google restricts personalized targeting for
      housing and credit ads in the US/Canada. Don't build remarketing or lookalike audiences from quiz answers, credit
      concerns or denial status (this code never sends them to ad platforms)
- [ ] If you serve EU/UK or other opt-in jurisdictions, set `VITE_REQUIRE_TRACKING_CONSENT=true`

## 7 · Tests performed (2026-10-28)
- `npm run build`: pass. App `tsc -b` and `functions` tsc: pass
- `npm test`: 13 pass, 0 fail
- Visual check (headless Chrome, production build, mock mode): landing at 1440px and 390px; intent page; checkout
  (no lead → inline details step; guide; upgrade with credit line); checklist; `/creditready`; upsell; welcome
  (guide + Kit); access (guide + Kit). No horizontal overflow at 390px.
- Found and fixed during QA: invisible white-on-white buttons on light surfaces (upsell accept, assessment start,
  price card — a pre-existing bug); option-card list stretching; checkout assurance/FAQ collision on mobile.

**Not performed:** Stripe test-mode payments, a real webhook delivery, ESP sends, GA4/Ads/Meta DebugView,
a deploy to a real Netlify site with Supabase + Blobs, automated browser click-through, screen-reader pass.

## 8 · Remaining risks
- No email goes out until the ESP is wired up, and that includes receipts and sign-in links. The site tells buyers an email is coming (**launch blocker**).
- Sign-in links, file delivery and the database are tested locally (SQLite, simulated signed URLs) but not yet against a live Supabase database and Cloudflare R2 bucket.
- The client-side mock entitlement store is ignored in production by design, but always confirm `VITE_FUNNEL_MODE=production`.
