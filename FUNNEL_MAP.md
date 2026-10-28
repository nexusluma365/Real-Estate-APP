# RentReady Funnel Map

> **Updated 2026-10-28.** The current money path is
> `/` (trust bar → finder → options with prices → objections) → `/checkout?product=guide|creditready|upgrade`
> (name + email captured inline) → Kit: `/complete-your-system` → `/welcome` · Book: `/welcome` (credited $32 upgrade to the Digital Bundle) → `/access`.
> **Products (2026-10-28 rev. 2):** Before They Say No™ physical book $47.99 · RentReady Digital Bundle $79.99 (book + 20 Word dispute letters + video guide) · Playbook $100 (one-click after the Bundle). The $179.99 Kit is retired; the `creditready` id now means the Digital Bundle.
> Not-ready visitors: exit offer / final band → `/checklist` (free; optional opt-in). Purchases are reported once via
> `analytics.trackPurchase()` with the verified amount. The step tables below describe the original
> `/start → /learn → /creditready` path, which still works. See `CHANGELOG.md` for every event and route added.

`RentReady → Lead → Education → CreditReady → Checkout → Playbook → Game Plan → Access`

Every event below is sent through `src/lib/analytics.ts → track()`, which automatically attaches
`lead_id, session_id, customer_id, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, landing_intent, page_path, ts`
plus any allowed props (`product, order_value, revenue, transaction_id, cta_location, step, method, variant, reason, resource`).
Credit ranges, income, assessment answers and card data are never allowed into analytics.

Lifecycle (email) hooks go through `src/lib/lifecycle.ts → emitLifecycle()`.

---

## Step 1 — Awareness & Attraction

| | |
|---|---|
| **Routes** | `/` and intent pages: `/apartment-with-bad-credit`, `/apartment-approval-requirements`, `/apartment-application-denied`, `/apartment-credit-requirements`, `/rent-with-collections`, `/first-apartment`, `/rental-screening` |
| **Component** | `src/pages/Landing.tsx` (one template). Copy from `src/config/headlines.ts` (A/B variants via `?v=afford\|income\|found\|worried` or `VITE_HERO_VARIANT`) and `src/config/intents.ts` (message match) |
| **Purpose** | Match high-intent search; name the worry; introduce Credit / Screening / Preparation |
| **Primary CTA** | CHECK MY RENTAL READINESS (hero, closing band, sticky mobile bar) |
| **Events** | `landing_view` (variant), `primary_cta_click` (cta_location, variant) |
| **Entry** | Any visit. UTMs/gclid captured on landing (`src/lib/attribution.ts`), intent slug stored as `landing_intent` |
| **Exit** | CTA click |
| **Data required** | None |
| **Next route** | `/start` (intent pages pass `?intent=<slug>`) |

## Step 2 — Opt-in bridge

| | |
|---|---|
| **Route** | `/start` (optional `?next=/path` for internal redirects, e.g. from `/checkout`) |
| **Component** | `src/pages/Start.tsx` → `src/lib/leadService.ts → captureLead()` |
| **Purpose** | Capture first name + email before any money is asked for |
| **Primary CTA** | CONTINUE MY RENTREADY PLAN |
| **Events** | `lead_started` (first field focus), `lead_captured`; Ads lead conversion; lifecycle `lead_captured` |
| **Entry** | Any visit |
| **Exit** | Valid submit → lead saved (mock: localStorage `rr.lead`; production: `POST /api/leads` + HttpOnly session cookie) |
| **Data captured** | `first_name, email, lead_id, session_id, utm_*, gclid, landing_intent, timestamp` (+ `email_consent` when `VITE_REQUIRE_EMAIL_CONSENT=true`) |
| **Next route** | `/learn` (or safe `next`) |

## Step 3 — Interest & Consideration

| | |
|---|---|
| **Route** | `/learn` |
| **Component** | `src/pages/Learn.tsx` |
| **Purpose** | Educate: the two sides of an application, six common factors, the $2,100 / $7,000 / 620–639 example |
| **Primary CTA** | SHOW ME HOW TO PREPARE |
| **Events** | `consideration_view`, `consideration_complete` (CTA click) |
| **Entry** | Normally after `/start`; open to direct visits (educational) |
| **Exit** | CTA click |
| **Data required** | None (uses first name if known) |
| **Next route** | `/creditready` |

## Step 4 — Desire & Intent (primary sales page)

| | |
|---|---|
| **Route** | `/creditready` |
| **Component** | `src/pages/CreditReady.tsx`; product data `src/config/products.ts`; objections `src/config/faq.ts` |
| **Purpose** | Sell the $179.99 CreditReady Action Kit honestly (7 modules, inclusions, objections, compliance) |
| **Primary CTA** | GET CREDITREADY — $179.99 (hero, price card, after FAQ, sticky) |
| **Events** | `credit_offer_view`, `credit_offer_cta` |
| **Entry** | Any visit |
| **Exit** | CTA click |
| **Data required** | None |
| **Next route** | `/checkout` (→ `/start?next=/checkout` if no lead yet) |

## Step 5 — Checkout

| | |
|---|---|
| **Route** | `/checkout` (guarded by `RequireLead`) |
| **Component** | `src/pages/Checkout.tsx` → `src/lib/paymentService.ts` |
| **Purpose** | Distraction-free $179.99 order; name/email pre-filled from Step 2 |
| **Primary CTA** | COMPLETE MY $179.99 ORDER |
| **States** | `preparing → ready → processing → verifying → success`, plus `declined`, `validation_error`, `network_error`, `config_error`; double-submit lock + idempotency key |
| **Events** | `checkout_view`, `checkout_started`, `credit_purchase_success` (revenue 47, transaction_id) or `credit_purchase_failed` (reason); Ads purchase conversion; lifecycle `credit_purchase_success` |
| **Entry** | Lead exists. Owners of CreditReady are redirected onward |
| **Exit** | **Server-verified** payment (`verifyPaymentServerSide`) → entitlement → saved PM recorded |
| **Data required** | lead (from Step 2). Card data is entered only in Stripe's iframe |
| **Next route** | `/complete-your-system` |

## Step 6A — One-click upsell

| | |
|---|---|
| **Route** | `/complete-your-system` (guarded: must own `creditready`; owners of `playbook` → `/welcome`) |
| **Component** | `src/pages/Upsell.tsx` |
| **Purpose** | Offer the $100 Property Manager Playbook; decline is equally visible |
| **Primary CTA** | YES — ADD THE PROPERTY MANAGER PLAYBOOK FOR $100 · Secondary: No thanks — continue with CreditReady only |
| **States** | `ready, processing, success, declined, requires_action, error` |
| **Events** | `upsell_view`, `upsell_accept_click`, `upsell_decline_click`, `upsell_purchase_success` (revenue 100) / `upsell_purchase_failed`; lifecycle `upsell_declined` / `upsell_failed` |
| **Entry** | Verified CreditReady purchase |
| **Exit** | Accept → server charges saved PM (`chargeUpsell`, only on click) → verified → `/welcome`; Decline → `/welcome` |
| **Next route** | `/welcome` |

## Step 6B — Congratulations

| | |
|---|---|
| **Route** | `/welcome` (guarded: owns `creditready`) |
| **Component** | `src/pages/Welcome.tsx` |
| **Purpose** | $179.99: "You're CreditReady." · $279.99: "Your complete RentReady system is unlocked." Owned / not-purchased list, no hard resell |
| **Primary CTA** | Start my assessment (or View my game plan if complete) |
| **Events** | `thankyou_view` (product creditready \| bundle) |
| **Next route** | `/assessment` |

## Step 6C — Onboarding assessment → Game Plan

| | |
|---|---|
| **Routes** | `/assessment`, `/gameplan` (guarded: owns `creditready`) |
| **Components** | `src/pages/Assessment.tsx` (questions in `src/config/assessment.ts`, conditional via `when`), `src/pages/Gameplan.tsx` (rules in `src/lib/gameplan.ts`) |
| **Purpose** | Conversational, one-question-at-a-time assessment with progress; plan labelled STRONG / REVIEW / NEEDS ATTENTION, never approved/denied |
| **Primary CTA** | Continue → Build my game plan |
| **Events** | `assessment_started`, `assessment_step_completed` (step = question id), `assessment_completed`, `gameplan_viewed`; lifecycle `assessment_incomplete`, `assessment_complete`, `gameplan_completed` |
| **Entry** | Owns CreditReady. Progress resumes after refresh |
| **Exit** | Last answer → `/gameplan`. Playbook owners see expanded sections |
| **Next route** | `/access` |

## Step 7 — Retention, advocacy, re-engagement

| | |
|---|---|
| **Route** | `/access` |
| **Component** | `src/pages/Access.tsx`, `src/components/Share.tsx` |
| **Purpose** | "Welcome back, [First Name]." My products, My RentReady plan, My next steps, Resources; in-app reminder mirroring planned emails; Share RentReady after plan completion |
| **Primary CTA** | Contextual reminder (Finish your plan / Review questions); SHARE RENTREADY |
| **Events** | `customer_returned` (once per session), `product_download` (resource), `share_clicked` (copy \| email \| sms \| native); lifecycle `product_accessed` |
| **Entry** | Owners see home; everyone else sees magic-link sign-in |
| **Data required** | Server entitlements |

## Planned email flows (`src/lib/lifecycle.ts → EMAIL_FLOWS`)

| Trigger | Delay | Subject |
|---|---|---|
| credit_purchase_success | immediate | Your CreditReady resources are waiting |
| checkout_abandoned (server-computed) | 1 hour | Finish your RentReady plan |
| assessment_incomplete | 24 hours | Ready to review your rental game plan? |
| gameplan_completed | 2 days | Before you apply, review these questions |
| upsell_declined | 5 days | See your application from the other side of the desk (single, soft) |
| upsell_failed | immediate | Your Playbook payment didn't go through |
