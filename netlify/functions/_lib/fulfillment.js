// The ONE place a succeeded one-time upsell PaymentIntent turns into an
// entitlement. confirm-intent, charge-upsell, stripe-webhook and the listing
// page's recovery path all call this, so they apply identical rules:
//
//   - the PaymentIntent must be for this lead, this product, at the
//     server-configured price (products.js), in USD, and actually succeeded;
//   - a repeat for the same PaymentIntent (webhook retry, refresh, the sync
//     call and the webhook both firing) is a no-op — no second email or
//     second funnel row;
//   - a SECOND succeeded PaymentIntent for a one-time product the lead
//     already owns is refunded automatically (rentready_reason:
//     duplicate_purchase). Different products and subscription payments are
//     never touched;
//   - an upsell never replaces the lead's saved card or Stripe customer.
const { productDef, ownsProduct, grantPatch, paymentIntentMatches } = require('./products');
const { manychatMetadata } = require('./manychat');

// Resolved per call (not at load) so every function — and every test that
// swaps these modules — sees the current store, email and funnel modules.
const store = () => require('./store');
const sendDownloadEmail = (leadId, product) => require('./download-email').sendDownloadEmail(leadId, product);
const logFunnelEvent = (event, fields) => require('./funnel').logFunnelEvent(event, fields);

const DOWNLOAD_EMAIL_PRODUCTS = new Set(['modern', 'luxury', 'apartment_prep']);

function idOf(value) {
  if (!value) return null;
  return typeof value === 'object' ? value.id || null : String(value);
}

async function refundDuplicate(stripe, pi, product) {
  const leadId = (pi.metadata || {}).leadId || '';
  try {
    await stripe.refunds.create(
      {
        payment_intent: pi.id,
        reason: 'duplicate',
        metadata: { leadId, product, rentready_reason: 'duplicate_purchase' },
      },
      { idempotencyKey: `rr-refund-duplicate:${pi.id}` }
    );
    console.warn('fulfillment refunded duplicate purchase', { paymentIntentId: pi.id, product, leadId, rentready_reason: 'duplicate_purchase' });
    return true;
  } catch (err) {
    console.error('fulfillment duplicate refund failed — refund manually in Stripe', { paymentIntentId: pi.id, product, leadId, code: err && err.code });
    return false;
  }
}

// Throws only if the entitlement write itself fails — callers decide whether
// that's a warning (the charge still succeeded) or a retryable error.
async function fulfillUpsellPaymentIntent(stripe, pi) {
  const metadata = (pi && pi.metadata) || {};
  const leadId = metadata.leadId;
  const product = metadata.product;
  if (!leadId || !productDef(product)) return { granted: false, reason: 'not_upsell' };
  if (!paymentIntentMatches(pi, product, leadId)) {
    console.error('fulfillment refused mismatched PaymentIntent', { paymentIntentId: pi.id, product, amount: pi.amount, currency: pi.currency });
    return { granted: false, reason: 'mismatch' };
  }
  if (pi.status !== 'succeeded') return { granted: false, reason: 'not_succeeded' };

  const current = await store().getEntitlements(leadId);
  const recordedMap = current.productPaymentIntents && typeof current.productPaymentIntents === 'object' ? current.productPaymentIntents : {};
  const recorded = recordedMap[product] || null;

  if (ownsProduct(current, product)) {
    if (recorded && recorded !== pi.id) {
      const refunded = await refundDuplicate(stripe, pi, product);
      return { granted: false, duplicate: true, refunded, entitlements: current };
    }
    // Same PaymentIntent seen again, or a purchase recorded before
    // PaymentIntent ids were tracked: already fulfilled, nothing to do.
    return { granted: true, alreadyFulfilled: true, entitlements: current };
  }

  const patch = {
    ...grantPatch(product, current),
    ...manychatMetadata(metadata.manychat_contact_id),
    productPaymentIntents: { ...recordedMap, [product]: pi.id },
  };
  const entitlements = await store().patchEntitlements(leadId, patch);

  if (DOWNLOAD_EMAIL_PRODUCTS.has(product)) {
    try {
      await sendDownloadEmail(leadId, product);
    } catch (err) {
      console.error('fulfillment download email error', err);
    }
  }
  await logFunnelEvent('upsell_paid', { lead_id: leadId, payment_id: pi.id, amount: (pi.amount_received || pi.amount || 0) / 100, detail: { product } });
  return { granted: true, first: true, entitlements };
}

module.exports = { fulfillUpsellPaymentIntent, idOf };
