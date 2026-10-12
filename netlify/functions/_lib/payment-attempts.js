// Per-lead, per-product charge attempt tracking.
//
// Why: the browser used to send a brand-new random idempotency key on every
// click, so a double-click, a second tab, or repeated "try again" presses
// each became a separate charge attempt on the same card. Banks treat a run
// of declines on one card as suspicious, and the customer kept being offered
// a card that had just come back "insufficient funds".
//
// Now the server derives the idempotency key from (lead, product, attempt
// window, failures so far). Two simultaneous clicks produce the SAME key, so
// Stripe runs the charge once. A new key is only minted after a recorded
// failure, and after MAX_FAILED_ATTEMPTS failures — or immediately on
// insufficient_funds — the saved card is not tried again for that product
// until the window expires or the customer's card changes.
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 2;

const MESSAGES = {
  insufficient_funds:
    'Your bank declined this card for insufficient funds, so we won’t try it again. Please use a different card.',
  retry_limit:
    'This card has been declined twice, so we’ve stopped trying it to protect your account. Please use a different card.',
  declined:
    'Your bank declined this purchase. You can try once more, or use a different card.',
  authentication_failed:
    'Your bank couldn’t verify this purchase. You can try once more, or use a different card.',
};

function attemptState(entitlements, product, paymentMethodId, now = Date.now()) {
  const all = (entitlements && entitlements.paymentAttempts) || {};
  const prev = all[product];
  const fresh = { windowStart: now, failures: 0, blocked: false, lastDeclineCode: null, paymentMethodId: paymentMethodId || null, pendingPaymentIntentId: null };
  if (!prev || typeof prev !== 'object') return fresh;
  if (!prev.windowStart || now - Number(prev.windowStart) > WINDOW_MS) return fresh;
  if ((prev.paymentMethodId || null) !== (paymentMethodId || null)) return fresh; // new card, clean slate
  return {
    windowStart: Number(prev.windowStart),
    failures: Number(prev.failures) || 0,
    blocked: !!prev.blocked,
    lastDeclineCode: prev.lastDeclineCode || null,
    paymentMethodId: prev.paymentMethodId || null,
    pendingPaymentIntentId: prev.pendingPaymentIntentId || null,
  };
}

function blockedReason(state) {
  if (!state) return null;
  if (state.blocked && state.lastDeclineCode === 'insufficient_funds') return 'insufficient_funds';
  if (state.blocked || state.failures >= MAX_FAILED_ATTEMPTS) return 'retry_limit';
  return null;
}

function idempotencyKey(leadId, product, state) {
  return `${leadId}:${product}:w${state.windowStart}:a${state.failures}`;
}

function afterFailure(state, declineCode) {
  const failures = (state.failures || 0) + 1;
  const code = declineCode || 'declined';
  return {
    ...state,
    pendingPaymentIntentId: null,
    failures,
    lastDeclineCode: code,
    blocked: code === 'insufficient_funds' || failures >= MAX_FAILED_ATTEMPTS,
  };
}

function attemptsPatch(entitlements, product, state) {
  return { paymentAttempts: { ...((entitlements && entitlements.paymentAttempts) || {}), [product]: state } };
}

function clearedAttemptsPatch(entitlements, product) {
  if (!entitlements || !entitlements.paymentAttempts || !entitlements.paymentAttempts[product]) return {};
  const next = { ...((entitlements && entitlements.paymentAttempts) || {}) };
  delete next[product];
  return { paymentAttempts: next };
}

function failureReason(state) {
  return blockedReason(state) || (state.lastDeclineCode === 'authentication_failed' ? 'authentication_failed' : 'declined');
}

function failureResponse(state) {
  const reason = failureReason(state);
  return {
    ok: true,
    status: 'failed',
    reason,
    declineCode: state.lastDeclineCode || null,
    useDifferentCard: reason === 'insufficient_funds' || reason === 'retry_limit',
    attemptsRemaining: state.blocked ? 0 : Math.max(0, MAX_FAILED_ATTEMPTS - (state.failures || 0)),
    message: MESSAGES[reason] || MESSAGES.declined,
  };
}

function declineCodeFromError(err) {
  const raw = (err && err.raw) || {};
  return (err && (err.decline_code || raw.decline_code)) || (err && (err.code || raw.code)) || 'declined';
}

module.exports = {
  WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  MESSAGES,
  attemptState,
  blockedReason,
  idempotencyKey,
  afterFailure,
  attemptsPatch,
  clearedAttemptsPatch,
  failureResponse,
  declineCodeFromError,
};
