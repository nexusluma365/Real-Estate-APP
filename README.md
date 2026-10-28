# RentReady — werentreadygo.com

Rental-application readiness funnel. Products: **Before They Say No™** (physical book, $47.99) and the
**RentReady Digital Bundle** ($79.99 — book + 20 Word dispute letters + step-by-step video guide), with a $32 upgrade
for book owners and the optional **Property Manager Playbook** ($100, one click after the Bundle).

Stack: React + Vite front end · Netlify Functions API (`/api/*`) · Supabase PostgreSQL · private Cloudflare R2 downloads · Stripe.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — mock mode, no keys needed
npm run build      # type-check + production build to dist/
npm run preview    # serve the build
npm test           # unit tests + end-to-end API test on a real SQLite database
npm run check      # typecheck (app + API) + tests + build — run before every push
```

Mock mode simulates leads, payments, entitlements and file delivery so the whole funnel can be clicked
through. Checkout and upsell show a **development simulator** to test approve / decline / network error /
bank-confirmation states. Reset demo data from **/access → Development tools**.

## Docs
* `CHANGELOG.md` — the 2026-10 conversion-system upgrade: what changed and why
* `LAUNCH_CHECKLIST.md` — integration status, deployment, Stripe / email / Ads / Meta checklists, QA results, risks
* `EMAIL_SEQUENCES.md` — copy + timing + exit rules for every lifecycle email
* `FUNNEL_MAP.md` — every step, route, CTA, event, entry/exit condition
* `INTEGRATION_GUIDE.md` — Netlify deployment, API contracts, Stripe, email, files, analytics, Ads
* `.env.example` — every variable, public vs secret
* `schema.sql` — database tables (apply once to Supabase using the SQL Editor)
* `design/` — source artwork (not used by the build)

## Where things live
* Copy & configuration: `src/config/` (headlines, intents, products, FAQ, assessment, resources, testimonials)
* Pages: `src/pages/` · Components: `src/components/` · Services: `src/lib/` · Styles: `src/styles/global.css`
* Server: `netlify/functions/` (entry points) and `netlify/lib/` (handlers, Stripe, sessions, database/blob bindings)
* Security headers / SPA routing: `public/_headers`, `public/_redirects`

## Adding a Google Ads intent page
Add an entry to `src/config/intents.ts`. It is routed automatically at `/<slug>`, appears in the footer,
and feeds the same funnel. Add it to `public/sitemap.xml`.

## Compliance guardrails built in
No fake reviews, counts, logos, timers or scarcity. Testimonials ship disabled and empty
(`src/config/testimonials.ts`). No approval, deletion or score guarantees. "No thanks" is always visible.
The $100 upsell is charged only after an explicit click. Card data never touches this app.
