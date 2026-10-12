// "Is this browser allowed to charge the lead's saved card?"
//
// Yes only when its rr_session cookie (see session.js) carries the
// SetupIntent that saved that card during the trial checkout. A leadId,
// email, URL parameter or localStorage value alone never qualifies.
const { idOf } = require('./fulfillment');

async function isVerifiedPayer(stripe, session, entitlements, leadId) {
  if (!session || session.leadId !== leadId || !session.si) return false;
  if (!entitlements || !entitlements.stripeCustomerId || !entitlements.defaultPaymentMethodId) return false;
  if (entitlements.cardSetupIntentId) return entitlements.cardSetupIntentId === session.si;
  // Record written before cardSetupIntentId was tracked: confirm with Stripe
  // that this browser's SetupIntent is the one that saved this lead's card.
  const si = await stripe.setupIntents.retrieve(session.si).catch(() => null);
  return !!(
    si &&
    si.status === 'succeeded' &&
    (si.metadata || {}).leadId === leadId &&
    idOf(si.customer) === entitlements.stripeCustomerId &&
    idOf(si.payment_method) === entitlements.defaultPaymentMethodId
  );
}

module.exports = { isVerifiedPayer };
