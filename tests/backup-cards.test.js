// Backup cards: a different card that pays an upsell is saved (with notice)
// as a backup, and a failed $19.99 renewal is retried once on each backup.
const test = require('node:test');
const assert = require('assert');
const { setup, post, completeSignup } = require('./helpers/payment-harness');

const LEAD = 'lead_b';
const SECRET = 'whsec_backup_test';

async function memberWithDeclinedUpsell(options = {}) {
  const h = setup(options);
  const { cookie } = await completeSignup(h, { leadId: LEAD, pm: 'pm_main' });
  h.stripe.cards.pm_main = { ...h.stripe.cards.pm_main, behavior: 'insufficient_funds' };
  const declined = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'apartment_prep' }, { cookie });
  return { h, cookie, declined };
}

function invoiceFailedEvent(h, invoice) {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  const payload = JSON.stringify({ id: `evt_${invoice.id}_${Math.random()}`, type: 'invoice.payment_failed', data: { object: invoice } });
  return { httpMethod: 'POST', headers: { 'stripe-signature': h.stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET }) }, body: payload };
}

function openRenewalInvoice(h, { failedCard = 'pm_main' } = {}) {
  const ent = h.store.ents.get(LEAD);
  const sub = h.stripe.state.subscriptions.get(ent.listingSubscriptionId);
  sub.status = 'past_due';
  const piId = 'pi_invoice_1';
  h.stripe.state.intents.set(piId, { id: piId, status: 'requires_payment_method', amount: 1999, currency: 'usd', customer: ent.stripeCustomerId, metadata: {}, last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', payment_method: { id: failedCard } } });
  const invoice = { id: 'in_renewal_1', object: 'invoice', status: 'open', amount_due: 1999, customer: ent.stripeCustomerId, subscription: sub.id, payment_intent: piId, billing_reason: 'subscription_cycle' };
  h.stripe.state.invoices.set(invoice.id, invoice);
  return invoice;
}

test('the card form on a member\'s upsell saves the new card as a backup, with notice', async () => {
  const { h, declined } = await memberWithDeclinedUpsell();
  assert.equal(declined.json.status, 'requires_payment_method');
  assert.equal(declined.json.saveAsBackup, true);
  const pi = h.stripe.state.intents.get(declined.json.paymentIntentId);
  assert.equal(pi.setup_future_usage, 'off_session');
  assert.equal(pi.customer, h.store.ents.get(LEAD).stripeCustomerId);

  h.stripe.browserConfirm(declined.json.clientSecret, 'pm_backup');
  const confirmed = await post(h.handlers['confirm-intent'], { leadId: LEAD, paymentIntentId: declined.json.paymentIntentId, product: 'apartment_prep' });
  assert.equal(confirmed.json.status, 'succeeded');
  const ent = h.store.ents.get(LEAD);
  assert.deepEqual(ent.backupPaymentMethodIds, ['pm_backup']);
  assert.equal(ent.defaultPaymentMethodId, 'pm_main', 'main subscription card unchanged');
  assert.equal(h.stripe.cards.pm_backup.customer, ent.stripeCustomerId, 'card attached to the customer');
  assert.equal(h.stripe.state.charges.filter((c) => c.product === 'apartment_prep').length, 1, 'still exactly one $20 charge');
});

test('guest card-form purchases (no session) never save a card to anyone', async () => {
  const h = setup();
  await completeSignup(h, { leadId: LEAD, pm: 'pm_main' });
  const guest = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'modern' });
  assert.equal(guest.json.saveAsBackup, false);
  const pi = h.stripe.state.intents.get(guest.json.paymentIntentId);
  assert.equal(pi.setup_future_usage, undefined);
  h.stripe.browserConfirm(guest.json.clientSecret, 'pm_stranger');
  await post(h.handlers['confirm-intent'], { leadId: LEAD, paymentIntentId: guest.json.paymentIntentId, product: 'modern' });
  assert.equal(h.store.ents.get(LEAD).backupPaymentMethodIds, undefined);
});

test('one-click upsells on the main card are unchanged (no backup, no setup_future_usage)', async () => {
  const h = setup();
  const { cookie } = await completeSignup(h, { leadId: LEAD, pm: 'pm_main' });
  const res = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'gameplan' }, { cookie });
  assert.equal(res.json.status, 'succeeded');
  assert.equal(h.stripe.state.intents.get(res.json.paymentIntentId).setup_future_usage, undefined);
  assert.equal(h.store.ents.get(LEAD).backupPaymentMethodIds, undefined);
});

test('a failed renewal is paid with the backup card — once, off-session, same invoice', async () => {
  const { h, declined } = await memberWithDeclinedUpsell();
  h.stripe.browserConfirm(declined.json.clientSecret, 'pm_backup');
  await post(h.handlers['confirm-intent'], { leadId: LEAD, paymentIntentId: declined.json.paymentIntentId, product: 'apartment_prep' });

  const invoice = openRenewalInvoice(h);
  const res = await h.handlers['stripe-webhook'](invoiceFailedEvent(h, invoice));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(h.stripe.state.invoicePayCalls.map((c) => [c.id, c.params.payment_method, c.params.off_session]), [['in_renewal_1', 'pm_backup', true]]);
  assert.equal(h.stripe.state.invoices.get('in_renewal_1').status, 'paid');
  assert.equal(h.stripe.state.charges.filter((c) => c.invoiceId).length, 1);
  assert.ok(h.funnel.some((e) => e.event === 'subscription_paid_backup_card'));
  assert.equal(h.store.ents.get(LEAD).defaultPaymentMethodId, 'pm_main', 'main card stays the subscription card');

  // Stripe redelivers the failure event: no second charge.
  await h.handlers['stripe-webhook'](invoiceFailedEvent(h, { ...invoice }));
  assert.equal(h.stripe.state.charges.filter((c) => c.invoiceId).length, 1);
});

test('each backup card is tried at most once per invoice, even when it also declines', async () => {
  const { h, declined } = await memberWithDeclinedUpsell();
  h.stripe.browserConfirm(declined.json.clientSecret, 'pm_backup');
  await post(h.handlers['confirm-intent'], { leadId: LEAD, paymentIntentId: declined.json.paymentIntentId, product: 'apartment_prep' });
  h.stripe.cards.pm_backup = { ...h.stripe.cards.pm_backup, behavior: 'insufficient_funds' };

  const invoice = openRenewalInvoice(h);
  for (let i = 0; i < 3; i += 1) await h.handlers['stripe-webhook'](invoiceFailedEvent(h, { ...invoice }));
  const real = h.stripe.state.invoicePayCalls.filter((c) => c.params.payment_method === 'pm_backup');
  assert.equal(new Set(real.map((c) => c.opts.idempotencyKey)).size, 1, 'one idempotency key → one real attempt');
  assert.equal(h.stripe.state.invoices.get('in_renewal_1').status, 'open');
  assert.equal(h.stripe.state.charges.filter((c) => c.invoiceId).length, 0);
});

test('never retries with the card that just failed or another copy of it', async () => {
  const { h, declined } = await memberWithDeclinedUpsell();
  // The "backup" is the same physical card as the main one (same fingerprint).
  h.stripe.cards.pm_copy = { behavior: 'success', fingerprint: 'fp_pm_main' };
  h.stripe.browserConfirm(declined.json.clientSecret, 'pm_copy');
  await post(h.handlers['confirm-intent'], { leadId: LEAD, paymentIntentId: declined.json.paymentIntentId, product: 'apartment_prep' });
  assert.deepEqual(h.store.ents.get(LEAD).backupPaymentMethodIds, ['pm_copy']);

  const invoice = openRenewalInvoice(h, { failedCard: 'pm_main' });
  await h.handlers['stripe-webhook'](invoiceFailedEvent(h, invoice));
  assert.equal(h.stripe.state.invoicePayCalls.length, 0);
});

test('no backup cards, paid invoices and Support-membership invoices are left alone', async () => {
  const h = setup();
  await completeSignup(h, { leadId: LEAD, pm: 'pm_main' });
  const invoice = openRenewalInvoice(h);
  await h.handlers['stripe-webhook'](invoiceFailedEvent(h, invoice));
  assert.equal(h.stripe.state.invoicePayCalls.length, 0, 'no backup card on file');

  h.store.ents.get(LEAD).backupPaymentMethodIds = ['pm_backup'];
  h.stripe.cards.pm_backup = { behavior: 'success', customer: h.store.ents.get(LEAD).stripeCustomerId };
  h.stripe.state.invoices.get(invoice.id).status = 'paid';
  await h.handlers['stripe-webhook'](invoiceFailedEvent(h, { ...invoice, status: 'paid' }));
  assert.equal(h.stripe.state.invoicePayCalls.length, 0, 'already paid');

  const membership = { id: 'sub_support', status: 'past_due', customer: h.store.ents.get(LEAD).stripeCustomerId, metadata: { leadId: LEAD, plan: 'monthly' } };
  h.stripe.state.subscriptions.set(membership.id, membership);
  h.stripe.state.invoices.set('in_support', { id: 'in_support', status: 'open', amount_due: 900, customer: membership.customer, subscription: membership.id });
  await h.handlers['stripe-webhook'](invoiceFailedEvent(h, { id: 'in_support', status: 'open', amount_due: 900, customer: membership.customer, subscription: membership.id }));
  assert.equal(h.stripe.state.invoicePayCalls.length, 0, 'only the listing membership uses backup cards');
});

test('a backup card detached from the customer is skipped', async () => {
  const { h, declined } = await memberWithDeclinedUpsell();
  h.stripe.browserConfirm(declined.json.clientSecret, 'pm_backup');
  await post(h.handlers['confirm-intent'], { leadId: LEAD, paymentIntentId: declined.json.paymentIntentId, product: 'apartment_prep' });
  h.stripe.cards.pm_backup = { ...h.stripe.cards.pm_backup, customer: null };
  await h.handlers['stripe-webhook'](invoiceFailedEvent(h, openRenewalInvoice(h)));
  assert.equal(h.stripe.state.invoicePayCalls.length, 0);
});
