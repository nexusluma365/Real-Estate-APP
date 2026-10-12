// Safe, normalized diagnostics for subscription billing failures, so the
// funnel sheet can tell "customers' cards were declined for insufficient
// funds" apart from "our payment implementation is failing".
//
// Only categories, Stripe's short codes and the card funding type are
// recorded — never card numbers, billing details or raw Stripe objects.
const { describePaymentError } = require('./payment-errors');

const CATEGORIES = ['insufficient_funds', 'authentication_required', 'expired_card', 'card_declined', 'processing_error', 'unknown'];

function idOf(value) {
  if (!value) return null;
  return typeof value === 'object' ? value.id || null : String(value);
}

// Stripe error / last_payment_error → one of CATEGORIES.
function categorizeBillingFailure(error) {
  if (!error || (!error.code && !error.decline_code && !error.type)) return 'unknown';
  const { code } = describePaymentError(error);
  if (['insufficient_funds', 'authentication_required', 'expired_card', 'processing_error'].includes(code)) return code;
  if (['card_declined', 'incorrect_cvc', 'payment_method_error'].includes(code)) return 'card_declined';
  return 'unknown';
}

// Reads the failed payment behind an invoice from Stripe and summarizes it.
async function invoiceFailureDetails(stripe, invoice) {
  let lastError = null;
  const piId = idOf(invoice && invoice.payment_intent);
  if (piId) {
    const pi = await stripe.paymentIntents.retrieve(piId).catch(() => null);
    lastError = (pi && pi.last_payment_error) || null;
  }
  const pm = lastError && lastError.payment_method;
  return {
    category: categorizeBillingFailure(lastError),
    stripeCode: (lastError && lastError.code) || null,
    declineCode: (lastError && lastError.decline_code) || null,
    funding: (pm && pm.card && pm.card.funding) || null,
    attemptCount: typeof invoice.attempt_count === 'number' ? invoice.attempt_count : null,
    billingReason: invoice.billing_reason || null,
    nextAttemptAt: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toISOString() : null,
  };
}

module.exports = { CATEGORIES, categorizeBillingFailure, invoiceFailureDetails };
