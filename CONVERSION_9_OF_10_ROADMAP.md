# RentReady — 9/10 design targets, not verified business ratings

## Changes implemented
- Search-intent headline and direct location search on `/second-chance-apartments`.
- Search intent (`mode=second-chance`) now initializes the Finder in second-chance mode.
- City/ZIP handoff initializes Finder area and paid-search attribution parameters are preserved in the URL.
- Explicit first-month and renewal disclosures above the fold.
- Finder headline and upsell claims revised to avoid suggesting every listing is verified or guaranteed.

## Scale to 9/10 — prerequisites
- Inventory: reliable, authorized listing feeds, freshness checks, per-property source evidence and coverage metrics by city. Do not advertise cities with thin supply.
- Acquisition: separate search-intent and education campaigns; exact/phrase match first; negative keywords; match ad headline to landing page.
- Economics: measure net cash collected, payment failure, refunds, churn, and cost per acquired paying customer. Pause campaigns with unsustainable CAC.
- Sales: allow genuine free previews, show paid features clearly, disclose recurring charges, enable self-service cancellation and avoid fake scarcity.
- Operations: automate listing expiration, verification refresh, support and disputes, with audit trails.
- Compliance: review housing advertising policies, data-use rights, privacy, subscription terms and any screening-related claims.

## Required before live traffic
- `npm ci && npm run check` in root; `npm ci && npm run build` in finder.
- Test Finder query parameters, search relevance, all buttons, mobile layouts, production redirects and API failure states.
- Test Stripe paid membership, renewals, cancellation, failed payments and access control using test-mode webhooks.
- Validate Google Ads purchase conversion against verified server-side paid transaction IDs, with deduplication.
- Verify actual listing availability and screening source evidence in the target market.

A 9/10 *potential* rating is not evidence of profitable conversion; actual customers and paid traffic must establish it.
