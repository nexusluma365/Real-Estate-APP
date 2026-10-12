// Which saved cards may start the 7-day listing trial.
//
// Evaluated SERVER-SIDE on the PaymentMethod retrieved from Stripe after the
// SetupIntent succeeds — never on funding/brand/last4 sent by the browser,
// and never from BIN databases. Uses Stripe's paymentMethod.card.funding:
// credit | debit | prepaid | unknown.
//
// Policy: credit and debit are accepted; prepaid is rejected. "unknown" is
// rejected by default; set LISTING_TRIAL_ALLOW_UNKNOWN_FUNDING=true to allow
// it without changing checkout code.
const ACCEPTED_FUNDING = ['credit', 'debit'];

function allowUnknownFunding() {
  return String(process.env.LISTING_TRIAL_ALLOW_UNKNOWN_FUNDING || '').toLowerCase() === 'true';
}

function evaluatePaymentMethod(paymentMethod, options = {}) {
  if (!paymentMethod || paymentMethod.type !== 'card' || !paymentMethod.card) {
    return { eligible: false, reason: 'unsupported_payment_method', funding: null };
  }

  const funding = String(paymentMethod.card.funding || 'unknown').toLowerCase();

  if (funding === 'prepaid') {
    return { eligible: false, reason: 'prepaid_not_supported', funding };
  }

  const allowUnknown = options.allowUnknown !== undefined ? !!options.allowUnknown : allowUnknownFunding();
  if (funding === 'unknown' && allowUnknown) {
    return { eligible: true, reason: null, funding };
  }

  if (!ACCEPTED_FUNDING.includes(funding)) {
    return { eligible: false, reason: 'unsupported_card_funding', funding };
  }

  return { eligible: true, reason: null, funding };
}

function customerIdOf(value) {
  if (!value) return null;
  return typeof value === 'object' ? value.id || null : String(value);
}

// The card used for the trial must belong to the SetupIntent's customer
// (and, when the lead already has one, the lead's RentReady customer).
// Stripe attaches the card to the customer when the SetupIntent succeeds; a
// card attached to any OTHER customer is never accepted.
function paymentMethodOwnedBy(paymentMethod, setupCustomer, leadCustomer) {
  const owner = customerIdOf(paymentMethod && paymentMethod.customer);
  if (owner && owner !== setupCustomer) return false;
  if (owner && leadCustomer && owner !== leadCustomer) return false;
  return true;
}

module.exports = { evaluatePaymentMethod, paymentMethodOwnedBy, ACCEPTED_FUNDING };
