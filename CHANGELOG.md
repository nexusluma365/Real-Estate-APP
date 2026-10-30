# Changelog

## 2026-10-30 (rev. 11) — "View Second Chance Communities In This Area"
- The Finder's "Explore Apartment Communities" section is now "View Second Chance Communities In This Area": RentReady's
  verified second-chance listings for the visitor's current area (same-state "nearby" ones when the city has none).
  Non-members see a blurred card with only the rent (or rent range), city, beds/baths and Unlock Access — the server
  sends nothing else; members see full details. Honest empty state when no verified listings exist.
- "More Second-Chance Apartments" follows: the rest of the city's verified second-chance listings plus others in the
  state (`include_nearby=1`), blurred for non-members. Google communities are no longer in this section (still in search).
- Listings support a rent range (`rent_max_cents`, admin field "Highest rent"); shown as "$1,250–$1,600/month".
- Fixed: the "View Property" button on community cards was squashed to a thin bar.

## 2026-10-29 (rev. 10) — Finder conversion: local discovery, sign-in states, unlock-to-listing
- Menu by membership state (server-decided): guest → Premium Membership + Sign In; member → My Account (Premium
  indicator) + Sign Out; payment failed → + Update Payment (Stripe portal); lapsed → + Reactivate. Free Finder always.
- Sign in: email link from /account (also from the offer's "Already a member? Sign in"), now for Premium-only members
  too, returning to the exact page (`next`, same-site only). `POST /api/session/logout`.
- Finder opens near the visitor without surprise prompts: link ?q=/?city= → last search on this device → precise
  location only if already permitted → approximate area from Netlify IP geo (`GET /api/geo`, labelled approximate).
  Intro loader skipped for ad/search deep links. Compact hero "Find Apartments That Fit Your Situation."
- "Apartments Near You": RentReady listings first (verified second-chance on top), server-side rent/bedroom/second-chance
  filters with an honest "N don't match" count, then Google results. Locked card copy per spec.
- Offer: "Unlock RentReady Premium", 8 benefits, "Unlock Premium for $5", billing/cancellation/privacy links.
  Unlocking a card returns to the same search with "Welcome to RentReady Premium!" and "View Apartment Details".
- Listing page: Contact Property, Save Apartment, View Location, Back to Results; final-decision note.
- Inactive members: "Premium Access Is Currently Unavailable" with Update Payment or Reactivate Premium (Finder + account).
- Welcome Back panel: saved apartments, recent searches, real new-listing counts (or "no new"), membership status.
- Analytics: finder_opened, finder_location_set, locked_listing_view (on screen, once), premium_listing_unlocked,
  ad attribution (gclid/utm) on every Finder event; admin funnel table, cost per signup, coverage by city, saved searches.
- /privacy page (factual, from the code — review with counsel). Finder never scrolls sideways at 320px.

## 2026-10-29 (rev. 9) — RentReady 2.0: Premium membership, sourced listings, member accounts
- **RentReady Premium** — $5 first month, then $19.99/month until canceled (Stripe Billing, Stripe-hosted checkout with the
  terms on the pay button). Server-side status from webhooks + the checkout return; access policy: active → access;
  failed renewal → 7-day grace while Stripe retries; canceled → access to the end of the paid period. Stripe customer
  portal for card updates, invoices and self-serve cancellation. One-time catalog setup: `POST /api/admin/premium-setup`.
- **Listings** (`rr_listings`): admin-added, sourced records classified standard / verified second-chance / criteria
  unknown / unavailable. Verified second-chance requires a source URL, a verification date and the quoted policy.
  Free visitors see a locked “Second-Chance Apartment” card (rent, city, beds/baths only — the server never sends the
  rest); members see everything. Google Places results are never labelled second-chance.
- **Finder**: RentReady listings under every city search, Unlock Access → offer (price, renewal, cancel, no-guarantee),
  checkout returns to the same search (`?q=`), heart-to-save, save search & alerts, `/finder/listing/:id`, recently viewed.
- **Main site**: hero CTAs “Find Apartments” + “Get the Book”; `/premium` (offer + plain-English terms); `/account`
  dashboard (membership & billing, saved apartments, saved searches with new-listing counts and alert toggles, recently
  viewed, purchases, preparation tools); menu gains Premium and My Account; sitemap/robots updated.
- **Emails**: membership welcome, renewal receipt, failed payment (Stripe hosted payment link), cancellation confirmed
  (with access end date), membership ended, and daily de-duplicated new-listing alerts (`listing-alerts` scheduled function).
- **Admin**: Premium panel (members, intro month, MRR, past due, joins/ends, revenue, renewal success, unlock → join funnel),
  listings manager with re-verification reminders.
- Migration: `supabase/migrations/20261029120000_rentready_premium.sql` (RLS on, no anon access).

## 2026-10-29 (rev. 8) — 1-minute download links
- Every product download link now expires 60 seconds after it is created (was 5 minutes). Buyers keep their purchase:
  each Download click on /welcome, the purchase confirmation page or /access creates a fresh 1-minute link. A download
  that starts within the minute finishes even on a slow connection. Pages note "each download link works for 1 minute".
- Receipts no longer carry 30-day file links; they have an "Open my downloads" button to /access. Links from older
  receipts go to /access to sign in.
- New `GET /api/admin/download-test` (admin token): a fresh 1-minute link to the Bundle ZIP for checking the real file.
- Checkout restores an expired session from the saved email instead of showing "Your session expired".

## 2026-10-29 (rev. 7) — RentReady Finder redesign
- New layout after the premium property reference: full-bleed dusk hero with a big bold headline and pill buttons;
  a floating search card over the hero edge (pill search field, Use My Location, Search Now, and five quick-filter
  tiles: distance, bedrooms, rent, type, second-chance); rounded photo cards; a large image/text feature block;
  step cards. Navy pill buttons, cool light canvas, softer shadows, staged entrance and hover motion.
- iPhone-setup-style loader: "Hey!" → "Welcome to RentReady Finder" → "We’re searching apartments · Hang tight…" →
  "Let’s get to know each other", each fading in from a blur with a light sweep over drifting colour fields.
  Full screen once per browser session (~8 s, Skip / Escape); a looping inline version runs while a search loads.
- Placeholder community cards no longer use real-looking photos (navy skyline art + "Layout preview · Not a listing").
- All search, filter, second-chance, results and property-page behaviour is unchanged.

## 2026-10-29 (rev. 6) — site menu + RentReady Finder at /finder
- Three-line menu in the top-right of the sales header (home, intent pages, checklist and other marketing pages; not on
  checkout, upsell or customer pages). It turns into a close icon and opens a panel from the right: Home, Find Apartments
  (`/finder/`), Before They Say No™ (`#get`), How It Works (`#how`), Contact (support email). Escape, outside click, focus
  loop, scroll lock and reduced motion are supported. Page content is unchanged (pixel-compared screen by screen).
- RentReady Finder (`rentready-finder/`, its own Vite/Tailwind app) is built into `dist/finder/` by `npm run build:finder`
  and served at `/finder` with deep links and refreshes. Its Google Places API runs as `netlify/functions/finder-api.mjs`
  (re-exports the Finder's own function) at `/finder/api/*`. Needs `GOOGLE_MAPS_API_KEY` on Netlify.
- Finder navigation gains a subtle "Back to RentReady" link (desktop and mobile).
- Finder now uses the RentReady logo (same house mark, wordmark, typeface and size) in its header and footer, and the RentReady favicon.
- Headers: images from Unsplash and Google Places photos allowed; geolocation allowed for this site only (Finder's
  "Use My Location", asked only on click).

## 2026-10-28 (rev. 5) — receipts, downloads, shipping updates, setup health
- Purchase receipts are emailed through Resend straight from the Stripe webhook (once per order): order summary, private
  30-day download links for the Bundle files that work without signing in (entitlement re-checked; refunds revoke them),
  and "your book is on its way — we'll email you as soon as it ships". Sign-in links are emailed the same way.
- /admin → **Books to ship**: shipping address from Stripe, carrier/tracking fields, *Mark shipped* emails the customer once.
- /admin → **Setup health** (`/api/admin/health`): which settings are present, database check, and whether each product
  file is uploaded to R2. Shows statuses only, never values.
- The free-book popup now opens 30 seconds into every new session — each page load, refresh, new tab or return visit —
  and not again while the visitor moves between pages; its book image is larger.

## 2026-10-28 (rev. 4) — "Get this book for free" popup
- The 30-second offer now runs site-wide (mounted in `App.tsx`) on every pre-purchase page, desktop and mobile; it stays off
  `/creditready`, checkout and all customer pages, never shows to buyers, and shows at most once a day.
- Headline "GET THIS BOOK FOR FREE", book image, email field → `/creditready?source=exit_offer`, which confirms the free book.
  The popup states the book is free with the paid Digital Bundle and that the price is shown before buying.
- Fixed: the popup never appeared when the API was unreachable, or for visitors who were already leads.
- Fixed: an email-only sign-up no longer erases a first name already saved for that email; checkout hides the empty name line.

## 2026-10-28 (rev. 3) — backend moved to Netlify
- One Netlify Function (`netlify/functions/api.mts`) serves every `/api/*` route with the same contracts — no frontend changes.
  It applies the origin check and security headers (formerly the Cloudflare middleware) and turns crashes into clean 500s.
- Database: Cloudflare D1 → **Turso** (libSQL, SQLite-compatible), so `schema.sql` and every query are unchanged.
- Product files: Cloudflare R2 → **Netlify Blobs** (`product-files` store).
- Abandoned-checkout cron Worker → **Netlify Scheduled Function** (`abandoned-checkouts.mts`); the public cron endpoint and `CRON_SECRET` are gone.
- New end-to-end API test on a real SQLite database (`tests/api.test.ts`); `npm run check` runs everything.
- Cleanup: removed `functions/`, `workers/`, `migrations/` (D1-only) and two stale docs; source art moved to `design/`; unused images archived.

## 2026-10-28 (rev. 2) — new product lineup
- **Before They Say No™ — $47.99** is now the **physical book only** (ships; checkout collects an address). The digital edition is retired.
- **RentReady Digital Bundle — $79.99** replaces the $179.99 Complete Kit: physical book + 20 Essential Credit Dispute Letter
  templates (Microsoft Word) + step-by-step video guide. It keeps the `creditready` id, so entitlements, upsell and game plan are unchanged.
- **Upgrade book → Bundle: $32** ($79.99 − $47.99). Nothing ships twice; the letters and videos unlock immediately.
- **Playbook $100 upsell** now follows a Bundle purchase (full or upgrade).
- New artwork: `Rent Ready Digital Bundle.png` → `src/assets/rentready-digital-bundle{,-768}.webp` (2.2 MB → 187 KB / 66 KB) with the PNG as fallback.
- Video guide is delivered through `/api/files?key=creditready/video-guide` → entitlement check → redirect to the private `VIDEO_GUIDE_URL`.
- Copy updated everywhere (landing, quiz, options, FAQ, checkout, `/creditready`, upsell, welcome, access, server descriptions, emails, tests).

## 2026-10-28 — conversion-system upgrade

Original kept untouched at `../rentready-baseline-2026-10-28/`. Status of every integration: `LAUNCH_CHECKLIST.md`.

## Landing page (`/` and all 7 intent pages): the page now does the selling
- **Trust bar** under the hero: Stripe checkout, one-time payment, money-back window (from config), instant access, no credit pull. Every claim is enforced in code.
- **Hero:** shows the price next to the CTA, plus a "Not sure which option fits you? Answer 3 quick questions" path.
- **30-second finder** (`QualifyQuiz`): 3 skippable questions → a recommended option with a personalized, honest reason (e.g. with 7 days left, disputes won't finish in time, so focus on knowing and explaining). Never gates content.
- **Options section** (`#options`): Digital Edition $47.99 vs Complete Kit $179.99 side by side with real mockups, "best if", contents, delivery, and "your $47.99 counts if you upgrade" to remove fear of picking wrong.
- **Objection handling** (`#faq`): 11 answers built from live config (bad credit, already denied, applying soon, which one, physical vs digital, delivery, guarantee, subscription, credit pull, refund) plus a three-card "our promise". Intent pages lead with their own questions (`faqFirst`) and their searchers' words (`recognition`). Both existed in config but were never rendered before.
- **Exit offer:** desktop exit intent or mobile idle after reading most of the page. At most once a week; never shown to leads or customers. Offers the free checklist.
- **Free Before-You-Apply Checklist** (`/checklist`): fully readable without email, printable, optional explicit opt-in, then a soft book CTA.

## Checkout
- No more bounce to `/start`: name + email is **step 1 inside checkout**, with the order summary visible.
- **"What happens after you order"**, assurance row, quick-answer FAQ, decline reassurance ("you have not been charged"), terms/privacy links.
- **Digital → Complete Kit upgrade at $132** (`product=upgrade`). The server enforces it: guide owners can only buy the upgrade, and nobody can re-buy what they own.
- Abandonment starts (`checkout_started`) once the lead reaches the payment form.

## Post-purchase
- **Upsell:** "what's already in your Kit vs only in the Playbook" table so nothing is sold twice. Accept/decline copy no longer says "CreditReady". Value comes from the product config, not a hardcoded 100.
- **Welcome** now serves Digital Edition buyers too ("start reading now" plus one quiet credited-upgrade offer).
- **Access:** guide owners see the $132 credited upgrade (previously linked to the full $179.99). Fixed file delivery (client and server disagreed). Magic-link sign-in implemented.
- `/creditready` page: real bundle image, guarantee, digital alternative, merged FAQ. Renamed leftover "CreditReady" labels.

## Fixed (pre-existing)
- White-on-white buttons on light surfaces, including the **$100 upsell accept button**, "Start my assessment" and the price-card CTA.
- Purchase analytics could double count on reload. Now de-duplicated per transaction, with the verified amount.
- `/api/events` dropped everything. It now stores allow-listed, non-personal fields for the dashboard.
- Magic link was a stub; file delivery returned a stream to code expecting JSON.
- "20+" vs "20" templates inconsistency.

## Tracking
- GA4 recommended events: `view_item`, `begin_checkout`, `add_payment_info`, `generate_lead`, `purchase` (value, currency, transaction_id, items).
- Optional Meta Pixel (no advanced matching; Purchase `eventID` = PaymentIntent id for CAPI de-dup).
- Optional consent banner + Google Consent Mode v2 (`VITE_REQUIRE_TRACKING_CONSENT`).
- New funnel events: `product_view`, `options_view`, `qualification_*`, `faq_open`, `exit_offer_*`, `free_resource_*`, `upgrade_*`.
- Pixels never receive names, emails, quiz answers or anything credit-related (tested).

## Server / data
- `PRICES.upgrade = 13200`, `purchaseAllowed()`, `entitlementFor()`. Refunds: full refunds revoke access, partial refunds don't; both are recorded.
- Lifecycle facts are stored once (unique lead+event+ref) and forwarded to `ESP_WEBHOOK_URL` with an HMAC signature and `marketing_allowed`.
- Server-only events: `purchase_completed`, `payment_failed`, `refund_processed` (webhook), `checkout_abandoned` (`/api/cron/abandoned` + `workers/cron`).
- Leads store consent basis/text/time, source, product interest, quiz answers, intent tier and recommendation (progressive profiling; nothing gets wiped).
- `/api/admin/metrics` + `/admin` dashboard (bearer token): funnel, revenue, AOV, upsell take rate, high-intent %, refunds, recovery, revenue by source, and CPL/CAC/ROAS/contribution margin from spend you enter.
- `/api/esp/unsubscribe` keeps opt-outs in sync. Middleware exempts bearer-authed server-to-server routes from the Origin check.
- Schema: `schema.sql` (fresh) and `migrations/0002_funnel.sql` (existing DBs).

## New files
`src/components/{Funnel,LeadForm,ConsentBanner}.tsx`, `src/pages/{Checklist,Admin}.tsx`, `src/config/qualification.ts`,
`src/lib/qualification.ts`, `functions/api/{cron/abandoned,admin/metrics,esp/unsubscribe,access/verify}.ts`,
`migrations/0002_funnel.sql`, `workers/cron/*`, `tests/*`, `EMAIL_SEQUENCES.md`, `LAUNCH_CHECKLIST.md`, `CHANGELOG.md`.
