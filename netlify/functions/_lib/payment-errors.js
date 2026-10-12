// Turns a Stripe error (or a PaymentIntent's last_payment_error) into a
// small, browser-safe { code, message } pair. The real Stripe codes are
// logged server-side; the browser only ever sees one of the codes below.
// Fraud-related decline codes (stolen_card, fraudulent, ...) are reported as
// a plain card_declined, as Stripe recommends.
const MESSAGES = {
  insufficient_funds: 'Your card was declined for insufficient funds. You can try a different card.',
  card_declined: 'Your card was declined. You can try a different card.',
  expired_card: 'Your card has expired. Please use a different card.',
  incorrect_cvc: 'Your card’s security code is incorrect. Please check it or use a different card.',
  authentication_required: 'Your bank needs to verify this purchase. Please complete the verification or use a different card.',
  processing_error: 'There was a problem processing your card. Please try again or use a different card.',
  payment_method_error: 'This card can’t be used for this purchase. Please use a different card.',
  stripe_error: 'We couldn’t reach our payment processor. Please try again in a moment.',
  internal_error: 'Something went wrong on our side. You have not been charged. Please try again.',
};

const PAYMENT_METHOD_CODES = new Set([
  'incorrect_number',
  'invalid_number',
  'invalid_expiry_month',
  'invalid_expiry_year',
  'invalid_cvc',
  'incorrect_zip',
  'card_not_supported',
  'currency_not_supported',
  'payment_method_unactivated',
  'payment_method_unexpected_state',
  'payment_method_not_available',
]);

function classify(code, declineCode) {
  const c = String(code || '');
  const d = String(declineCode || '');
  if (d === 'insufficient_funds' || c === 'insufficient_funds') return 'insufficient_funds';
  if (c === 'expired_card' || d === 'expired_card') return 'expired_card';
  if (c === 'incorrect_cvc' || d === 'incorrect_cvc' || c === 'invalid_cvc') return 'incorrect_cvc';
  if (c === 'authentication_required' || d === 'authentication_required' || c === 'payment_intent_authentication_failure') {
    return 'authentication_required';
  }
  if (c === 'processing_error' || d === 'processing_error') return 'processing_error';
  if (PAYMENT_METHOD_CODES.has(c) || PAYMENT_METHOD_CODES.has(d)) return 'payment_method_error';
  if (c === 'card_declined' || d) return 'card_declined';
  return '';
}

function describePaymentError(err) {
  const raw = (err && err.raw) || err || {};
  const type = (err && err.type) || raw.type || '';
  const code = classify(raw.code || (err && err.code), raw.decline_code || (err && err.decline_code));
  if (code) return { code, message: MESSAGES[code] };
  if (type === 'StripeCardError' || type === 'card_error') return { code: 'card_declined', message: MESSAGES.card_declined };
  if (/^Stripe/.test(type) || /_error$/.test(type)) return { code: 'stripe_error', message: MESSAGES.stripe_error };
  return { code: 'internal_error', message: MESSAGES.internal_error };
}

// Non-sensitive diagnostics only: Stripe's own codes and the card funding
// classification (credit/debit/prepaid/unknown). Never card numbers.
function paymentErrorLogFields(err) {
  const raw = (err && err.raw) || err || {};
  const pm = raw.payment_method || {};
  return {
    type: (err && err.type) || raw.type || null,
    code: raw.code || null,
    decline_code: raw.decline_code || null,
    funding: (pm.card && pm.card.funding) || null,
    request_id: (err && err.requestId) || null,
  };
}

module.exports = { describePaymentError, paymentErrorLogFields, MESSAGES };
