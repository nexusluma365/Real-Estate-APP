// Trial card screening, run once the card has been saved (SetupIntent
// succeeded) and BEFORE the free trial subscription is created.
//
// Background: a SetupIntent only proves the card exists — banks approve it
// with a $0 check, so a card with $0 available (or a prepaid card loaded with
// a few cents) sails through signup and then fails the first real charge,
// the one-click upsell, with "insufficient funds".
//
// Two checks, both configurable with Netlify environment variables:
//   TRIAL_BLOCK_PREPAID_CARDS      default "true"  — reject prepaid/gift cards.
//   TRIAL_CARD_CHECK_AMOUNT_CENTS  default "100"   — place a $1.00 authorization
//       and cancel it immediately (never captured; the hold drops off the
//       customer's statement). Set "0" to turn it off, or e.g. "2000" to check
//       that the $20 upsell amount is available.
//
// The authorization is an on-session, customer-initiated check (the customer
// is on the checkout page). If the bank asks for 3-D Secure we cancel the
// check and let the trial continue — the card was already authenticated when
// it was saved. Stripe outages/API errors fail OPEN (trial continues) so a
// Stripe hiccup never blocks a legitimate signup.
const MESSAGES = {
  prepaid_card: 'Prepaid and gift cards can’t be used for the free trial. Please use a debit or credit card.',
  insufficient_funds: 'This card doesn’t have enough available funds. Please try a different card.',
  declined: 'Your bank declined this card. Please try a different card.',
};

function blockPrepaid() {
  return String(process.env.TRIAL_BLOCK_PREPAID_CARDS || 'true').trim().toLowerCase() !== 'false';
}

function checkAmountCents() {
  const raw = process.env.TRIAL_CARD_CHECK_AMOUNT_CENTS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return 100;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 50 ? n : 0; // Stripe's USD minimum is $0.50
}

function reject(reason, declineCode) {
  return { ok: false, reason, declineCode: declineCode || reason, message: MESSAGES[reason] || MESSAGES.declined };
}

async function cancelQuietly(stripe, id) {
  if (!id) return;
  try {
    await stripe.paymentIntents.cancel(id);
  } catch (err) {
    console.error('card-screening: could not cancel verification hold', id, err.code || err.message);
  }
}

async function screenTrialCard(stripe, { leadId, customerId, paymentMethodId, setupIntentId }) {
  if (!paymentMethodId) return { ok: true, skipped: 'no_payment_method' };

  if (blockPrepaid()) {
    let pm = null;
    try {
      pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    } catch (err) {
      console.error('card-screening: payment method lookup failed', err.code || err.message);
    }
    const funding = pm && pm.card && pm.card.funding;
    if (funding === 'prepaid') return reject('prepaid_card');
  }

  const amount = checkAmountCents();
  if (!amount) return { ok: true, skipped: 'auth_check_disabled' };

  let pi;
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethodId,
        payment_method_types: ['card'],
        capture_method: 'manual',
        confirm: true,
        description: 'RentReady card verification (authorization released immediately, not a charge)',
        metadata: { leadId, product: 'trial_card_check', setupIntentId: setupIntentId || '' },
      },
      { idempotencyKey: `${leadId}:trial-card-check:${setupIntentId || paymentMethodId}` }
    );
  } catch (err) {
    const raw = (err && err.raw) || {};
    const declineCode = err.decline_code || raw.decline_code || err.code || raw.code;
    const isCardError = err.type === 'StripeCardError' || raw.type === 'card_error';
    const intent = raw.payment_intent || err.payment_intent;
    if (intent && intent.id) await cancelQuietly(stripe, intent.id);
    if (isCardError) {
      if (declineCode === 'authentication_required') return { ok: true, skipped: 'authentication_required' };
      return reject(declineCode === 'insufficient_funds' ? 'insufficient_funds' : 'declined', declineCode);
    }
    console.error('card-screening: verification hold failed (allowing trial)', err.code || err.message);
    return { ok: true, skipped: 'stripe_error' };
  }

  await cancelQuietly(stripe, pi && pi.id);
  if (pi && (pi.status === 'requires_capture' || pi.status === 'succeeded')) return { ok: true, verified: true, amount };
  if (pi && pi.status === 'requires_payment_method') {
    const code = pi.last_payment_error && (pi.last_payment_error.decline_code || pi.last_payment_error.code);
    return reject(code === 'insufficient_funds' ? 'insufficient_funds' : 'declined', code);
  }
  // requires_action / processing: don't block the signup on the check.
  return { ok: true, skipped: pi ? pi.status : 'unknown' };
}

module.exports = { screenTrialCard, MESSAGES, checkAmountCents, blockPrepaid };
