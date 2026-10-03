# RentReady Stability & Security Audit — 2026-10-03

Visual design and funnel behavior are unchanged. Every fix below was verified with
the repo test suite (32/32 passing), the function checker, a production build,
and real-browser runs (Chromium, 375px mobile + 1440px desktop) of every route.

## Payments & security
- `confirm-intent.js`: rejects a PaymentIntent confirmed as a different product
  than Stripe recorded (blocked: $9.99 intent → $47/$97 entitlement).
- Preview listings (`get-apartment-results.js`): anonymous IDs, no photo resource
  names, no nearby areas. Photos load through an AES-256-GCM sealed, 6-hour token
  (`_lib/sign.js` → `seal/unseal`, accepted by `google-place-image.js?pt=`), so
  the Google place ID never reaches unpaid visitors. Requires `EMAIL_LINK_SECRET`
  (already required); without it preview cards show the placeholder instead.
- `submit-lead.js` email lookup returns only search fields (no phone, income,
  credit range, last name, or activity history).
- Listing page escapes all Google/OpenAI text, restricts links to http(s)/tel,
  and sanitizes IDs used in inline handlers.
- `stripe-webhook.js` returns 500 on processing failure so Stripe retries
  (entitlement patches are idempotent; emails are first-purchase guarded).
- `_lib/sign.js` `verify()` no longer throws on malformed tokens.

## Bugs
- Returning-visitor redirect built `?preview=1?category=…`; preview mode never
  turned on and returning unpaid renters hit a locked list. Fixed.
- Checkout summary showed raw values ("asap", "below 580"). Fixed labels.
- Legacy page scripts crashed with "Identifier already declared" on any re-run
  (each script now runs in its own block scope; inline onclick globals still work).
- Preview popup had an empty "View on maps" link; now shows the unlock button.
  Escape closes the popup. No image-search calls are made in preview.
- Terms page said $10; now $9.99.

## Speed
- Google place-detail lookups run 6 at a time (were sequential; could exceed the
  Netlify function time limit).
- Stripe.js loads async; `rrnLoadStripeJs()` reuses the tag and checkout awaits it.
- Vite bundles moved to `/static/` with immutable caching; security headers now
  apply to every route (`netlify.toml`).
- Premium pages: embedded base64 images extracted to `app/public/premium-media/`
  (byte-identical). Largest JS chunk 2.8 MB → 188 KB. Below-fold images lazy-load.
- Questionnaire typing animation updates one bubble instead of the whole chat.

## UX polish
- Clear validation messages: phone (10–15 digits), email, income/rent ranges.
- Enter while Aria is typing skips the animation instead of flashing an error.
- Stale-deploy chunk failures reload once, then show a Refresh screen.
- DM Sans now loads site-wide; desktop home hero fills the viewport.
- React StrictMode removed (it double-ran imperative page scripts in dev only).
