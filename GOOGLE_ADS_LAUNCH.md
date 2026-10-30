# RentReady Google Search conversion launch
## What changed
- New intent-specific `/second-chance-apartments` entry page with city/ZIP search, direct Finder handoff, clear paid-membership terms and accurate eligibility disclaimers.
- Replaced unqualified home-page approval promise with preparation-focused copy.
- Clarified that the physical book is a one-time purchase but Finder Premium is a separate recurring subscription.
- Added more honest language about screening policy and availability.

## Recommended campaign split
**Finder / transactional search:** exact and phrase match around `second chance apartments`, `apartments with bad credit`, `apartments accepting evictions` with city-specific terms only where verified inventory exists. Destination `/second-chance-apartments` with UTM parameters. Do not claim a property accepts evictions unless verified.

**Education / informational search:** `apartment application denied`, `what do landlords check`, `apartment credit requirements`. Destination existing corresponding intent pages, selling the book transparently.

**Negative keywords for first controlled test:** free housing, section 8 (unless supported), jobs, property manager jobs, mortgage, house for sale, government assistance, shelter, pdf free, template free. Review actual search-term reports before adding more.

## Critical launch gates (NOT verified)
1. Verify permission, currency, location and freshness of live listing data, including second-chance claims. Do not advertise a city without sufficient verified inventory.
2. Verify Stripe live checkout, $5 initial and $19.99 monthly recurring charges, webhook signature, server-side access enforcement, customer portal and cancellation.
3. Verify Google Ads purchase conversion only fires on a verified paid transaction; deduplicate by payment/transaction ID. Configure consent and enhanced conversions only if lawful and consented.
4. Review Google Ads housing-related targeting and personalized advertising policies; do not target protected characteristics or exploit financial distress.
5. Test on real mobile devices and desktop, keyboard navigation, finder search, payment failure, cancellation, password recovery, refund, and listing expiration.
6. Validate all testimonials, guarantees, email support and refund policy against real operations.
7. Start with a controlled experiment. Optimize for collected purchases, CAC and net contribution, not clicks or leads.

## Unverified
No live Stripe credentials, listing API credentials, analytics accounts, real payment events or browser/device test environment were provided. A 9/10 conversion rating and profitability cannot be honestly certified without traffic and cohort data.
