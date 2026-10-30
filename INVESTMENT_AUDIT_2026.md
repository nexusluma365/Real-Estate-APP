# RentReady investment and launch audit

## Verdict
The problem is urgent and high intent, but a scalable, profitable business has not been proven. Do not invest substantial ad spend until the gates below pass. 9/10 is a design target, not a measured business score.

## Sales architecture
- Transactional searches for second-chance apartments -> `/second-chance-apartments` -> city search -> Finder results -> clear optional Premium membership -> verified Stripe checkout -> member access.
- Informational searches about denials/credit -> corresponding intent-matched education pages -> book checkout. Avoid forcing book buyers into the subscription journey.
- Avoid targeting cities without demonstrable verified premium inventory.

## Changes in this version
- Clearer apartment-search hero that addresses bad credit and rental history without approval promises.
- Added step-by-step process and FAQ to answer high-friction objections before purchase.
- Expanded attribution handoff to gbraid/wbraid, in addition to UTM and gclid.
- Existing Finder membership disclosures and payment flow preserved.

## Required launch gates — not yet passed
1. `npm ci`, `npm run check`, and Finder build must succeed in an online CI environment. Offline install here was blocked by missing cached packages.
2. Test all Finder results, filters, search handoff, source evidence and inventory counts in each advertised city.
3. Stripe test-mode initial purchase, successful renewal, failed renewal, canceled membership, account access and webhook signature must be verified.
4. Validate real Google Ads paid conversion events using transaction IDs and correct attribution, without double counting.
5. Confirm housing ad compliance, listing/photo usage rights, accessibility and mobile UX.
6. Measure paid conversion, CAC, first-month cash, successful renewal rates, refunds and support costs. Only scale when contribution margin supports it.

## Unit economics
At $5 upfront, the first charge rarely covers search acquisition. If CPC=$1.50 and click-to-paid conversion=5%, CAC=$30. A customer with 2 successful $19.99 renewals brings $44.98 gross before payment fees, refunds and service costs. A customer with no renewals brings $5 gross. Forecast from *collected* payments, not promised subscription lifetime.

## Campaign setup
Start with high-intent exact/phrase terms, segmented by verified inventory market; use search term negatives, city-matched ads and destination URLs. Separate informational book queries. Start with a small controlled spend and hold until real paid conversions are observed.
