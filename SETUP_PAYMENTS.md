# Setting up the real payment backend

Netlify Functions + Stripe's server-side API. The checkout page is the only
place a card is ever typed: it is saved with a $0 SetupIntent, screened, and
used to start a 7-day free trial of the $19.99/month listing membership. The
$20 apartment upsells are genuine one-click charges against that saved card —
server-verified, not just a frontend flag.

```
Questionnaire → Checkout: card saved ($0), screened ($1 hold, released)
              → 7-day trial, then $19.99/month (Stripe Subscription)
              → Results
              → $20 Modern/Luxury List (one click, saved card)
              → Verified apartment results + email delivery
```

(Internal names still say `prescreen` / `paid10` / `paid27` from the old
$10/$27 pricing; `paid10` now means "trial card saved and subscription
started".)

## 1) Install dependencies

```
npm install
```

This pulls in `stripe`, `@netlify/blobs`, and `pdf-lib` for the functions
in `/netlify/functions`.

## 2) Environment variables (Netlify → Site settings → Environment variables)

| Variable | Where to get it |
|---|---|
| `STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → Developers → API keys. Public key served to the browser by `/.netlify/functions/config`. |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys. **Secret key — server only, never in frontend code.** |
| `STRIPE_WEBHOOK_SECRET` | Created in step 4 below. |
| `STRIPE_LISTING_PRICE_MONTHLY` | **Required.** Recurring Price ID (`price_...`, not `prod_...`) for the listing membership. Must be **$19.99 / month / USD** and in the same mode as `STRIPE_SECRET_KEY` (test Price with `sk_test_`, live Price with `sk_live_`) — signup is refused otherwise. |
| `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` | Only needed if `/membership` is used. Recurring Price IDs for the monthly/yearly Support membership. |
| `EMAIL_LINK_SECRET` | **Required.** Any long random string (e.g. `openssl rand -hex 32`). Signs the time-limited links that go out in emails **and the httpOnly payment session cookie** (`rrn_session`). Without it, checkout and one-click purchases are refused. Changing it signs every customer out of their payment session (they recover through their emailed link). |
| `TRIAL_BLOCK_PREPAID_CARDS` | Optional, default `true`. Rejects prepaid/gift cards at trial signup (they pass the $0 card check but usually fail the first real charge). Set `false` to allow them. |
| `TRIAL_CARD_CHECK_AMOUNT_CENTS` | Optional, default `100`. At trial signup, a $1.00 authorization is placed and **cancelled immediately** (never captured) to catch cards with no available funds. `0` turns it off; `2000` checks the full $20 upsell amount (the customer sees a temporary $20 pending hold). Minimum 50. |
| `GOOGLE_SCRIPT_URL` | The Apps Script web app URL. It is used server-side by lead capture and email delivery functions, and is no longer hardcoded into public HTML. |
| `GOOGLE_PLACES_API_KEY` | Google Maps Platform API key with Places API enabled. Required for verified Modern/Luxury apartment recommendations. Without it, the app will not invent apartment communities. |
| `OPENAI_API_KEY` | Optional. Used server-side only to rank/summarize verified Google Places properties. |
| `OPENAI_MODEL` | Optional. Defaults to `gpt-4.1-mini` for apartment ranking. |
| `CLOUDFLARE_DOWNLOAD_EMAIL_URL` | Optional. Cloudflare Worker `/send-download` URL for R2-backed paid download emails. If omitted, the current Apps Script email path is used. |
| `CLOUDFLARE_DOWNLOAD_EMAIL_SECRET` | Optional but recommended. Must match the Worker's `TRIGGER_SECRET`. |

Netlify Blobs (used for entitlements, saved answers, and the two protected
PDFs) needs no separate setup or account — it's provisioned automatically
for any site deployed on Netlify.

## 3) Keep keys in Netlify

Do not paste Stripe or Google keys into HTML files. The frontend asks
`/.netlify/functions/config` for the Stripe publishable key, and lead capture
posts through `/.netlify/functions/submit-lead`, which forwards to Apps Script
using the private `GOOGLE_SCRIPT_URL` environment variable.

## 4) Create the Stripe webhook

1. Deploy the site to Netlify first (the webhook needs a real URL).
2. Stripe Dashboard → Developers → Webhooks → **Add endpoint**.
3. Endpoint URL: `https://YOURDOMAIN/.netlify/functions/stripe-webhook`
4. Events to send (all of them — without the subscription/invoice events,
   trial→paid conversions, failed renewals and cancellations never reach
   the entitlement store, and cancelled customers keep showing as active):
   - `payment_intent.succeeded`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

The functions write entitlements synchronously the moment Stripe confirms a
charge, but the webhook is the **only** thing that sees what happens later:
the trial converting to paid, renewals, failed payments, cancellations, and
3-D-Secure completions after the customer closes the tab.

## 5) Redeploy the Google Apps Script

`google-apps-script/code.gs` now handles a second action, `sendEmail`,
alongside the existing lead-capture logic (which is untouched). In the
Apps Script editor: **Deploy → Manage deployments → Edit → New version →
Deploy.** The web app URL stays the same, so nothing else needs updating
besides `GOOGLE_SCRIPT_URL` in step 2.

## 6) Upload the two protected PDFs

The $20 Game Plan and $97 Credit Action Kit are real files a customer
downloads after paying — there's no public URL for them anywhere in the
site; `download-file.js` only serves them after checking the server-side
entitlement. Upload the actual PDFs once with the Netlify CLI:

```
npm install -g netlify-cli
netlify login
netlify blobs:set rrn-files gameplan  --input ./RentReady-Game-Plan.pdf  --site YOUR_SITE_ID
netlify blobs:set rrn-files creditkit --input ./RentReady-Credit-Action-Kit.pdf --site YOUR_SITE_ID
```

Until these are uploaded, a successful $20/$97 purchase still grants
entitlement correctly — the download link will just return a clear
"hasn't been uploaded yet" message instead of a file.

## 6b) Optional Cloudflare R2 email/download flow

The Cloudflare Worker scaffold lives in `cloudflare/download-email-worker`.
It verifies the lead's Supabase entitlement, checks the paid file exists in
R2, emails a signed `/download?token=...` link through Resend, then serves the
R2 object only if the token and entitlement are still valid.

Deploy it with Wrangler after creating an R2 bucket:

```
cd cloudflare/download-email-worker
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SECRET_KEY
wrangler secret put EMAIL_LINK_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put FROM_EMAIL
wrangler secret put TRIGGER_SECRET
wrangler deploy
```

Then set these in Netlify:

```
CLOUDFLARE_DOWNLOAD_EMAIL_URL=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/send-download
CLOUDFLARE_DOWNLOAD_EMAIL_SECRET=same_value_as_TRIGGER_SECRET
```

The Worker is configured for the R2 bucket `realestateproject`. Modern and
Luxury default to the object key `RentReady Guide.zip`; `gameplan` and
`creditkit` default to `gameplan.pdf` and `creditkit.pdf`. Override them with
Worker secrets like `MODERN_DOWNLOAD_KEY` or `LUXURY_DOWNLOAD_KEY` if your
bucket uses different paths.

## 7) Test with Stripe test mode

Use Stripe's test keys (`sk_test_` + `pk_test_`), and a **test-mode**
`STRIPE_LISTING_PRICE_MONTHLY`, with these card numbers on the checkout page:

| Card | Behavior |
|---|---|
| `4242 4242 4242 4242` | Succeeds immediately, no 3DS. |
| `4000 0025 0000 3155` | Requires 3-D Secure — confirms the `requires_action` handling on every step. |
| `4000 0000 0000 9995` | `insufficient_funds` — rejected at signup by the $1 check; the customer is asked for a different card. |
| `4000 0000 0000 0341` | Saves fine at signup, then every charge declines — the most realistic test of the $20 upsell decline path and the 2-attempt cap. |

Any future date for expiry, any 3 digits for CVC, any ZIP.

You can also use the Stripe CLI to forward webhooks to a local dev server:
`stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook`

### Payment security model (October 2026)

- **Session cookie, not leadId.** `submit-lead` issues a signed, httpOnly `rrn_session` cookie (`lead` scope) when a new lead is created. `confirm-intent` upgrades it to `paid` scope once the trial card is saved. `create-payment-intent` and `confirm-intent` require the lead's session; `charge-upsell`, `create-subscription` and `confirm-subscription` require the `paid` session. A leadId in a request body is only accepted if it matches the cookie. The signed email link (`return-access`) restores the session on a new device.
- **Email lookup.** The returning-renter lookup never returns a `lead_id`. It returns a 30-minute, preview-only token. Continuing to checkout from that preview creates a fresh profile, so the existing profile's saved card can never be used.
- **No unauthenticated overwrites.** `submit-lead` refuses to update an existing lead unless the request carries that lead's session.
- **On-session upsells.** One-click upsells are customer-initiated (no `off_session`). If the bank asks for 3-D Secure, the page completes it with Stripe.js.
- **Card screening at signup.** Prepaid cards are rejected, and a $1 authorization is placed and released before the trial starts (see the env vars above).
- **Retry cap.** The server derives the Stripe idempotency key per lead + product + 24h window, so double clicks or two tabs charge once. A saved card is tried at most twice per product. After an `insufficient_funds` decline it is not tried again, and the customer is told to use a different card.

Extra test cards for the new checks (test mode):

| Card | Behavior |
|---|---|
| `4000 0566 5566 5556` | Debit card — should pass screening. |
| `4000 0000 0000 9995` | `insufficient_funds` — now rejected at signup by the $1 check (customer is asked for a different card). |
| `4000 0000 0000 0341` | Saves fine, then every charge declines — use it to see the 2-attempt cap on the upsell pages. |

## What to verify end-to-end

This mirrors the test list from the funnel spec:

- [ ] Checkout saves the card ($0) and starts a 7-day trial subscription at $19.99/month
- [ ] Result renders immediately after payment, no upsell shown yet
- [ ] Download My Results produces a PDF of the renter's results, and only for that renter's own session or signed email link
- [ ] Email My Results sends a working, time-limited link
- [ ] Modern/Luxury option cards route to the premium page with the selected category
- [ ] $20 Modern/Luxury one-click succeeds with the saved card (no card form appears)
- [ ] Successful Modern/Luxury purchase renders Google Places-backed apartment results
- [ ] Apartment result email sends a signed, time-limited results link
- [ ] Modern/Luxury decline shows the short redirect message, continues to listings, and does not email the packet
- [ ] $20 decline shows the message, then fades in "Continue Without This →"
- [ ] $20 3DS card triggers the challenge and still completes correctly
- [ ] Refreshing or hitting back on any page after payment still shows the correct (paid) state, via `get-entitlements`
- [ ] Rapid double-clicking a purchase button never creates two charges (server-derived idempotency key + button lock)
- [ ] Calling `/.netlify/functions/charge-upsell` from another browser with just a leadId returns 401 and charges nothing
- [ ] Email lookup response contains no `lead_id`
- [ ] A prepaid card is rejected at trial signup with "use a debit or credit card"
- [ ] An upsell declined for insufficient funds shows "use a different card" and the card is not retried
- [ ] Cancelling the trial in Stripe flips the customer to inactive (needs the subscription webhook events)
- [ ] Thank You page's message matches whatever was actually purchased — never claims something was emailed that wasn't
- [ ] A manually edited `sessionStorage` flag cannot unlock a download — only a real server-side entitlement can

## What changed in this pass

**Kept exactly as-is:** the questionnaire (`/` /
`/renter-lead-form`), all page structure/CSS/typography/cards/buttons
across every page, and the lead-capture half of `code.gs`.

**Added:**
- `/netlify/functions/*` — the real backend (Stripe PaymentIntents/
  Subscriptions, entitlements via Netlify Blobs, protected file delivery,
  server-generated result PDF, email delivery).
- `app/public/assets/checkout-client.js` — shared frontend logic for the one-click
  purchase/3DS/entitlement calls used by `/game-plan`,
  apartment upsell pages. Purely behavioral —
  it doesn't style or render anything.
- `/rentready-review-checkout` — the dedicated RentReady trial checkout
  shown after the questionnaire analysis loader and before
  `/after-payment-results`.
- Server-guarded access checks and the unlocked result experience on
  `/after-payment-results`.
- Real one-click purchase buttons, `requires_action` (3DS) handling, and
  the "we couldn't complete this purchase" → fade-in "Continue Without
  This →" pattern on the apartment upsell pages.
- `/luxury-apartments-premium` and `/modern-apartments-premium` — saved-card
  $20 apartment upsells that redirect to `/real-estate-list` after payment
  succeeds or after the decline notice is shown.
- `/netlify/functions/get-apartment-results.js` — fetches factual property
  data from Google Places and optionally uses OpenAI server-side for ranking
  only. It returns no invented communities if Places is not configured.
- `/netlify/functions/join-waiting-list.js` — stores declined/opt-in waiting
  list entries in Netlify Blobs.
- `/thank-you` — final page, message and download links driven by the
  customer's actual server-verified purchase state.
- `sendEmail` action added to `google-apps-script/code.gs`.
- `package.json`, and `netlify.toml` updated to build the functions.
