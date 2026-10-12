// Trial card eligibility (server-side, from Stripe's PaymentMethod) and
// subscription billing diagnostics. Real functions + in-memory Stripe.
const test = require('node:test');
const assert = require('assert');
const { setup, post, cookieFrom, completeSignup, LISTING_PRICE_ID } = require('./helpers/payment-harness');
const { evaluatePaymentMethod, paymentMethodOwnedBy } = require('../netlify/functions/_lib/payment-method-eligibility');
const { categorizeBillingFailure } = require('../netlify/functions/_lib/billing-diagnostics');

const WEBHOOK_SECRET = 'whsec_eligibility_test';

function signup(funding, extra = {}) {
  const h = setup({ cards: { pm_card: { behavior: 'success', funding, ...extra } } });
  return completeSignup(h, { leadId: 'lead_e', pm: 'pm_card' }).then((r) => ({ h, ...r }));
}

function assertNoTrial(h, confirmed, code) {
  assert.equal(confirmed.statusCode, 400);
  assert.equal(confirmed.json.ok, false);
  assert.equal(confirmed.json.status, 'payment_method_not_eligible');
  assert.equal(confirmed.json.code, code);
  assert.match(confirmed.json.error, /standard bank debit or credit card/);
  assert.equal(h.stripe.state.subscriptionsCreated.length, 0, 'no subscription created');
  const ent = h.store.ents.get('lead_e') || {};
  assert.notEqual(ent.paid10, true, 'no paid10');
  assert.notEqual(ent.listingAccessStatus, 'active', 'no listing access');
  assert.equal(ent.defaultPaymentMethodId || null, null, 'rejected card not stored as default');
  assert.equal(ent.cardSetupIntentId || null, null);
  assert.equal(/pm_|cus_|seti_/.test(confirmed.body), false, 'no Stripe ids in the response');
  assert.deepEqual(h.emails.welcome, []);
}

// ---------- eligibility helper ----------
test('evaluatePaymentMethod policy', () => {
  const card = (funding) => ({ type: 'card', card: { funding } });
  assert.deepEqual(evaluatePaymentMethod(card('credit')), { eligible: true, reason: null, funding: 'credit' });
  assert.deepEqual(evaluatePaymentMethod(card('debit')), { eligible: true, reason: null, funding: 'debit' });
  assert.deepEqual(evaluatePaymentMethod(card('prepaid')), { eligible: false, reason: 'prepaid_not_supported', funding: 'prepaid' });
  assert.deepEqual(evaluatePaymentMethod(card('unknown')), { eligible: false, reason: 'unsupported_card_funding', funding: 'unknown' });
  assert.deepEqual(evaluatePaymentMethod({ type: 'card', card: {} }), { eligible: false, reason: 'unsupported_card_funding', funding: 'unknown' });
  assert.equal(evaluatePaymentMethod({ type: 'us_bank_account' }).reason, 'unsupported_payment_method');
  assert.equal(evaluatePaymentMethod(null).reason, 'unsupported_payment_method');
  // "unknown" is a policy switch, not a code change.
  assert.equal(evaluatePaymentMethod(card('unknown'), { allowUnknown: true }).eligible, true);
  process.env.LISTING_TRIAL_ALLOW_UNKNOWN_FUNDING = 'true';
  assert.equal(evaluatePaymentMethod(card('unknown')).eligible, true);
  assert.equal(evaluatePaymentMethod(card('prepaid')).eligible, false, 'prepaid stays rejected');
  delete process.env.LISTING_TRIAL_ALLOW_UNKNOWN_FUNDING;

  assert.equal(paymentMethodOwnedBy({ customer: 'cus_a' }, 'cus_a'), true);
  assert.equal(paymentMethodOwnedBy({ customer: 'cus_b' }, 'cus_a'), false);
  assert.equal(paymentMethodOwnedBy({ customer: null }, 'cus_a'), true);
});

// ---------- 1, 2, 9: eligible cards keep the existing trial ----------
test('1/2/9: credit and debit start the unchanged 7-day trial on the $19.99 Price', async () => {
  for (const funding of ['credit', 'debit']) {
    const { h, confirmed, intent } = await signup(funding);
    assert.equal(confirmed.json.status, 'succeeded', funding);
    assert.equal(confirmed.json.subscriptionStatus, 'trialing');
    const sub = h.stripe.state.subscriptionsCreated[0];
    assert.equal(h.stripe.state.subscriptionsCreated.length, 1);
    assert.equal(sub.params.trial_period_days, 7);
    assert.deepEqual(sub.params.items, [{ price: LISTING_PRICE_ID }]);
    assert.equal(sub.params.default_payment_method, 'pm_card');
    assert.deepEqual(sub.params.payment_settings, { save_default_payment_method: 'on_subscription', payment_method_types: ['card'] });
    assert.equal(sub.opts.idempotencyKey, 'lead_e:listing-subscription:trial-1999-v4');
    assert.equal(confirmed.json.subscriptionAmount, 19.99);
    const ent = h.store.ents.get('lead_e');
    assert.equal(ent.paid10, true);
    assert.equal(ent.listingAccessStatus, 'active');
    assert.equal(ent.defaultPaymentMethodId, 'pm_card');
    assert.equal(ent.cardSetupIntentId, intent.json.setupIntentId);
    assert.deepEqual(h.stripe.state.detached, []);
    assert.equal(h.stripe.state.charges.length, 0, 'still nothing charged at signup');
  }
});

// ---------- 3, 7, 8: prepaid ----------
test('3/7/8: prepaid card → no subscription, no entitlement, card detached, safe funnel row', async () => {
  const { h, confirmed } = await signup('prepaid');
  assertNoTrial(h, confirmed, 'prepaid_not_supported');
  assert.deepEqual(h.stripe.state.detached, ['pm_card']);
  const rejected = h.funnel.filter((e) => e.event === 'payment_method_rejected');
  assert.deepEqual(rejected, [{ event: 'payment_method_rejected', lead_id: 'lead_e', detail: { reason: 'prepaid_not_supported', funding: 'prepaid' } }]);
  assert.equal(h.funnel.some((e) => e.event === 'trial_started'), false);
});

// ---------- 4: unknown funding ----------
test('4: unknown funding → no subscription (default policy)', async () => {
  const { h, confirmed } = await signup('unknown');
  assertNoTrial(h, confirmed, 'unsupported_card_funding');
});

// ---------- 5: non-card ----------
test('5: non-card PaymentMethod → no subscription', async () => {
  const { h, confirmed } = await signup('credit', { pmType: 'us_bank_account' });
  assertNoTrial(h, confirmed, 'unsupported_payment_method');
});

// ---------- 6: ownership ----------
test('6: a PaymentMethod attached to another Stripe customer is rejected', async () => {
  const h = setup();
  const submitted = await post(h.handlers['submit-lead'], { lead_id: 'lead_e', email: 'e@example.com' });
  let cookie = cookieFrom(submitted);
  const intent = await post(h.handlers['create-payment-intent'], { leadId: 'lead_e', email: 'e@example.com' }, { cookie });
  cookie = cookieFrom(intent) || cookie;
  h.stripe.browserConfirmSetup(intent.json.clientSecret, 'pm_card');
  h.stripe.cards.pm_card = { ...h.stripe.cards.pm_card, customer: 'cus_someone_else' };
  const res = await post(h.handlers['confirm-intent'], { leadId: 'lead_e', setupIntentId: intent.json.setupIntentId, product: 'prescreen' }, { cookie });
  assert.equal(res.statusCode, 403);
  assert.equal(h.stripe.state.subscriptionsCreated.length, 0);
  assert.notEqual((h.store.ents.get('lead_e') || {}).paid10, true);
});

// ---------- retry with a valid card ----------
test('after a prepaid rejection the customer can start the trial with a debit card', async () => {
  const h = setup({ cards: { pm_prepaid: { behavior: 'success', funding: 'prepaid' }, pm_debit: { behavior: 'success', funding: 'debit' } } });
  const first = await completeSignup(h, { leadId: 'lead_e', pm: 'pm_prepaid' });
  assert.equal(first.confirmed.json.code, 'prepaid_not_supported');
  // The page asks for a fresh SetupIntent for the new card.
  const again = await post(h.handlers['create-payment-intent'], { leadId: 'lead_e', email: 'renter@example.com' }, { cookie: first.cookie });
  assert.notEqual(again.json.setupIntentId, first.intent.json.setupIntentId);
  h.stripe.browserConfirmSetup(again.json.clientSecret, 'pm_debit');
  const ok = await post(h.handlers['confirm-intent'], { leadId: 'lead_e', setupIntentId: again.json.setupIntentId, product: 'prescreen' }, { cookie: cookieFrom(again) });
  assert.equal(ok.json.status, 'succeeded');
  assert.equal(h.stripe.state.subscriptionsCreated[0].params.default_payment_method, 'pm_debit');
  assert.equal(h.store.ents.get('lead_e').defaultPaymentMethodId, 'pm_debit');
});

// ---------- 10: duplicates ----------
test('10: duplicate confirm requests create one subscription', async () => {
  const { h, cookie, intent } = await signup('credit');
  const body = { leadId: 'lead_e', setupIntentId: intent.json.setupIntentId, product: 'prescreen' };
  const [a, b] = await Promise.all([
    post(h.handlers['confirm-intent'], body, { cookie }),
    post(h.handlers['confirm-intent'], body, { cookie }),
  ]);
  assert.equal(a.json.status, 'succeeded');
  assert.equal(b.json.status, 'succeeded');
  assert.equal(h.stripe.state.subscriptionsCreated.length, 1);
});

// ---------- an API outage is not a card problem ----------
test('a Stripe error while reading the card is retryable, not a card rejection', async () => {
  const h = setup();
  const submitted = await post(h.handlers['submit-lead'], { lead_id: 'lead_e', email: 'e@example.com' });
  const intent = await post(h.handlers['create-payment-intent'], { leadId: 'lead_e', email: 'e@example.com' }, { cookie: cookieFrom(submitted) });
  h.stripe.browserConfirmSetup(intent.json.clientSecret, 'pm_card');
  h.stripe.paymentMethods.retrieve = async () => { const e = new Error('connection'); e.type = 'StripeConnectionError'; throw e; };
  const res = await post(h.handlers['confirm-intent'], { leadId: 'lead_e', setupIntentId: intent.json.setupIntentId, product: 'prescreen' }, { cookie: cookieFrom(intent) });
  assert.equal(res.statusCode, 500);
  assert.notEqual(res.json.status, 'payment_method_not_eligible');
  assert.equal(h.stripe.state.subscriptionsCreated.length, 0);
});

// ---------- webhook diagnostics ----------
function signed(h, event) {
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  const payload = JSON.stringify(event);
  return { httpMethod: 'POST', headers: { 'stripe-signature': h.stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }) }, body: payload };
}

async function memberWithInvoice(declineCode, extraError = {}) {
  const { h } = await signup('credit');
  const ent = h.store.ents.get('lead_e');
  const sub = h.stripe.state.subscriptions.get(ent.listingSubscriptionId);
  sub.status = 'past_due';
  h.stripe.state.intents.set('pi_inv', {
    id: 'pi_inv', status: 'requires_payment_method', amount: 1999, currency: 'usd', metadata: {},
    last_payment_error: declineCode === null ? null : { type: 'card_error', code: 'card_declined', decline_code: declineCode, payment_method: { id: 'pm_card', card: { funding: 'debit', last4: '4242' } }, ...extraError },
  });
  const invoice = { id: 'in_1', object: 'invoice', status: 'open', amount_due: 1999, customer: ent.stripeCustomerId, subscription: sub.id, payment_intent: 'pi_inv', billing_reason: 'subscription_cycle', attempt_count: 1, next_payment_attempt: 1893456000 };
  return { h, sub, invoice };
}

test('11/12: invoice.payment_failed is logged with a normalized reason (insufficient_funds), retries untouched', async () => {
  const { h, sub, invoice } = await memberWithInvoice('insufficient_funds');
  const res = await h.handlers['stripe-webhook'](signed(h, { id: 'evt_f', type: 'invoice.payment_failed', data: { object: invoice } }));
  assert.equal(res.statusCode, 200);
  const row = h.funnel.find((e) => e.event === 'subscription_payment_failed');
  assert.deepEqual(row.detail, { reason: 'insufficient_funds', attempt_count: 1, billing_reason: 'subscription_cycle', funding: 'debit' });
  assert.equal(row.amount, 19.99);
  const issue = h.store.ents.get('lead_e').lastBillingIssue;
  assert.equal(issue.category, 'insufficient_funds');
  assert.equal(issue.declineCode, 'insufficient_funds');
  assert.equal(issue.invoiceId, 'in_1');
  assert.equal(JSON.stringify(issue).includes('4242'), false, 'no card details stored');
  // Stripe's retry schedule stays in charge: nothing cancelled.
  assert.equal(h.stripe.state.subscriptions.get(sub.id).status, 'past_due');
  assert.equal(h.store.ents.get('lead_e').listingAccessStatus, 'inactive');
});

test('12: failure categories', () => {
  assert.equal(categorizeBillingFailure({ code: 'card_declined', decline_code: 'insufficient_funds' }), 'insufficient_funds');
  assert.equal(categorizeBillingFailure({ code: 'authentication_required' }), 'authentication_required');
  assert.equal(categorizeBillingFailure({ code: 'expired_card' }), 'expired_card');
  assert.equal(categorizeBillingFailure({ code: 'card_declined', decline_code: 'do_not_honor' }), 'card_declined');
  assert.equal(categorizeBillingFailure({ code: 'card_declined', decline_code: 'stolen_card' }), 'card_declined');
  assert.equal(categorizeBillingFailure({ code: 'processing_error' }), 'processing_error');
  assert.equal(categorizeBillingFailure(null), 'unknown');
  assert.equal(categorizeBillingFailure({ type: 'api_error', code: 'rate_limit' }), 'unknown');
});

test('11: a failure with no error details is logged as unknown', async () => {
  const { h, invoice } = await memberWithInvoice(null);
  await h.handlers['stripe-webhook'](signed(h, { id: 'evt_u', type: 'invoice.payment_failed', data: { object: invoice } }));
  assert.equal(h.funnel.find((e) => e.event === 'subscription_payment_failed').detail.reason, 'unknown');
});

test('13: invoice.finalization_failed is logged safely and changes nothing', async () => {
  const { h, invoice } = await memberWithInvoice('insufficient_funds');
  const before = { ...h.store.ents.get('lead_e') };
  const failed = { ...invoice, status: 'draft', last_finalization_error: { code: 'customer_tax_location_invalid', type: 'invalid_request_error', message: 'Customer address 123 Main St is invalid' } };
  const res = await h.handlers['stripe-webhook'](signed(h, { id: 'evt_fin', type: 'invoice.finalization_failed', data: { object: failed } }));
  assert.equal(res.statusCode, 200);
  const row = h.funnel.find((e) => e.event === 'invoice_finalization_failed');
  assert.deepEqual(row.detail, { code: 'customer_tax_location_invalid', error_type: 'invalid_request_error', billing_reason: 'subscription_cycle' });
  assert.equal(JSON.stringify(row).includes('Main St'), false, 'no billing details logged');
  const after = h.store.ents.get('lead_e');
  assert.equal(after.lastBillingIssue.type, 'invoice_finalization_failed');
  assert.equal(after.listingAccessStatus, before.listingAccessStatus, 'access unchanged');
  assert.equal(after.paid10, before.paid10);
  assert.equal(h.stripe.state.invoicePayCalls.length, 0, 'no manual charge');
});

test('14/15: invoice.paid counts real $19.99 renewals, never the $0 trial invoice', async () => {
  const { h, sub } = await memberWithInvoice('insufficient_funds');
  await h.handlers['stripe-webhook'](signed(h, { id: 'evt_t', type: 'invoice.paid', data: { object: { id: 'in_trial', subscription: sub.id, amount_paid: 0 } } }));
  assert.equal(h.funnel.filter((e) => e.event === 'subscription_paid').length, 0, '$0 trial invoice is not revenue');
  h.stripe.state.subscriptions.get(sub.id).status = 'active';
  await h.handlers['stripe-webhook'](signed(h, { id: 'evt_p', type: 'invoice.paid', data: { object: { id: 'in_paid', subscription: sub.id, amount_paid: 1999 } } }));
  assert.deepEqual(h.funnel.filter((e) => e.event === 'subscription_paid').map((e) => e.amount), [19.99]);
  assert.equal(h.store.ents.get('lead_e').listingAccessStatus, 'active');
});
