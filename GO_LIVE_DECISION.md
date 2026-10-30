# RentReady — Investment and launch decision (2026-10-30)

## Verdict
**Conditional investment / not yet cleared for live paid acquisition.** The problem is severe and Google Search can bring intent, but demand does not establish willingness to pay for this particular inventory. No honest 9/10 conversion or scalability claim is possible without verified listings and cohort economics.

## Audited sales path
- Search-intent ads → `/second-chance-apartments?city=...` → city search → `/finder/?mode=second-chance&q=...` → property preview → optional Premium offer → Stripe checkout → verified entitlement.
- Information-intent ads → matching book education page → book checkout; avoid mixing these visitors into the Finder paywall.
- Never suggest an unconfirmed listing accepts evictions or low credit. Show verified screening evidence, source and checked date where available.
- Show $5 first month, $19.99 recurring monthly until canceled, terms, refund policy and easy cancellation before checkout. Do not advertise a free trial if money is charged.

## Critical gates — must all pass before ads
1. In the target city, manually audit a representative sample of live property records: listing accuracy, rights to photos, contact information, freshness and published screening evidence. No verified supply = do not advertise Premium for that city.
2. Confirm Stripe test-mode and then controlled live-mode payments: new member, returning member, failed payment, webhook, duplicate webhook, refund, cancellation, expiration and access denial. Verify real $5 and $19.99 schedule.
3. Confirm both apps build and deploy, `/finder` rewrite and deep links work, mobile/desktop interaction and accessibility; test Safari/Chrome and slow connections.
4. Verify Google Ads conversion fires only on server-verified successful paid order; preserve click IDs, consent controls and transaction-level deduplication. Test attribution end to end.
5. Verify customer support, policies, email delivery, domain configuration, privacy terms and cancellation portal.
6. Review Google Ads housing and personalized advertising rules and local consumer-protection law. Do not imply housing approval or exploit sensitive hardship.

## Initial Google Ads plan
- Single city with proven inventory, separate Finder and education campaigns, exact/phrase high-intent terms, location-specific ad copy, and conservative budgets.
- Examples: `second chance apartments [city]`, `apartments bad credit [city]`, `apartment application denied` (education landing only).
- Initial negative candidates: jobs, free pdf, mortgage, for sale, shelter; review real search terms and avoid excluding useful prospects blindly.
- Track impression → click → search → eligible preview → checkout started → payment succeeded → first renewal → cancellation/refund.
- Stop-loss and scale gates: CAC vs *collected* contribution margin after payment fees, refunds, support and inventory costs. Scale only when several cohorts show repeatable positive unit economics.

## Limitations
Static code review and local modifications do not prove live listings, payment credentials, deploy configuration, Google Ads compliance, actual conversion or profit. No production credentials were provided.
