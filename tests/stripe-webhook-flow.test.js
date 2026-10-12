// Stripe webhook on the production trial funnel: real signature checks over
// the raw body, idempotent upsell fulfillment, trial/listing subscription
// sync, renewals, cancellations, and funnel tracking.
const test = require('node:test');
const assert = require('assert');
const { setup } = require('./helpers/payment-harness');

const SECRET = 'whsec_test_secret';

function signed(h, event, { base64 = false, secret = SECRET } = {}) {
  const payload = JSON.stringify(event);
  return {
    httpMethod: 'POST',
    headers: { 'stripe-signature': h.stripe.webhooks.generateTestHeaderString({ payload, secret }) },
    isBase64Encoded: base64,
    body: base64 ? Buffer.from(payload, 'utf8').toString('base64') : payload,
  };
}

function piSucceeded(id, leadId, product, amount) {
  return {
    id: `evt_${id}`,
    type: 'payment_intent.succeeded',
    data: { object: { id, object: 'payment_intent', status: 'succeeded', amount, currency: 'usd', customer: 'cus_x', payment_method: 'pm_x', metadata: { leadId, product } } },
  };
}

function listingSub(id, leadId, status, extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id,
    object: 'subscription',
    status,
    customer: 'cus_1',
    default_payment_method: 'pm_1',
    current_period_start: now,
    current_period_end: now + 7 * 86400,
    cancel_at_period_end: false,
    metadata: { leadId, product: 'listing_membership', plan: 'trial_then_monthly' },
    ...extra,
  };
}

test.beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});

test('T: forged, unsigned, wrong-secret and tampered webhooks are rejected and grant nothing', async () => {
  const h = setup();
  const fake = piSucceeded('pi_fake', 'lead_x', 'creditkit', 9700);
  assert.equal((await h.handlers['stripe-webhook']({ httpMethod: 'POST', headers: {}, body: JSON.stringify(fake) })).statusCode, 400);
  assert.equal((await h.handlers['stripe-webhook']({ httpMethod: 'POST', headers: { 'stripe-signature': 't=1,v1=deadbeef' }, body: JSON.stringify(fake) })).statusCode, 400);
  assert.equal((await h.handlers['stripe-webhook'](signed(h, fake, { secret: 'whsec_attacker' }))).statusCode, 400);
  const tampered = signed(h, piSucceeded('pi_fake', 'lead_x', 'creditkit', 2000));
  tampered.body = tampered.body.replace('"amount":2000', '"amount":9700');
  assert.equal((await h.handlers['stripe-webhook'](tampered)).statusCode, 400);
  delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await h.handlers['stripe-webhook'](signed(h, fake))).statusCode, 400);
  assert.equal(h.store.patches.length, 0);
});

test('raw base64 body verified byte-for-byte; $20 Modern purchase granted with download email and funnel row', async () => {
  const h = setup({ entitlements: { lead_123: { paid10: true } } });
  const res = await h.handlers['stripe-webhook'](signed(h, piSucceeded('pi_m', 'lead_123', 'modern', 2000), { base64: true }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(h.store.patches, [{
    leadId: 'lead_123',
    patch: { paid27: true, addPurchasedCategory: 'modern', productPaymentIntents: { modern: 'pi_m' } },
  }]);
  assert.deepEqual(h.emails.download, [{ leadId: 'lead_123', product: 'modern' }]);
  assert.deepEqual(h.funnel.map((e) => e.event), ['upsell_paid']);
});

test('U: duplicate deliveries fulfil once — one grant, one email, one funnel row', async () => {
  const h = setup({ entitlements: { lead_789: { paid10: true } } });
  const event = piSucceeded('pi_prep', 'lead_789', 'apartment_prep', 2000);
  for (let i = 0; i < 3; i += 1) assert.equal((await h.handlers['stripe-webhook'](signed(h, event))).statusCode, 200);
  assert.equal(h.store.patches.length, 1);
  assert.deepEqual(h.emails.download, [{ leadId: 'lead_789', product: 'apartment_prep' }]);
  assert.equal(h.funnel.filter((e) => e.event === 'upsell_paid').length, 1);
});

test('a $20 PaymentIntent can never fulfil the $97 Credit Kit; failed payments grant nothing', async () => {
  const h = setup({ entitlements: { lead_1: { paid10: true } } });
  await h.handlers['stripe-webhook'](signed(h, piSucceeded('pi_cheap', 'lead_1', 'creditkit', 2000)));
  await h.handlers['stripe-webhook'](signed(h, {
    id: 'evt_fail',
    type: 'payment_intent.payment_failed',
    data: { object: { id: 'pi_f', metadata: { leadId: 'lead_1', product: 'modern' }, last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', payment_method: { card: { funding: 'debit' } } } } },
  }));
  assert.equal(h.store.patches.length, 0);
  assert.equal(h.store.ents.get('lead_1').paid97, false);
});

test('V: transient processing errors return 500 so Stripe retries', async () => {
  const h = setup();
  h.store.failPatches = true;
  const res = await h.handlers['stripe-webhook'](signed(h, piSucceeded('pi_x', 'lead_x', 'modern', 2000)));
  assert.equal(res.statusCode, 500);
});

test('Y/AA: trialing → listing access; renewal invoice keeps it and logs subscription_paid; failed renewal removes it', async () => {
  const h = setup();
  const sub = listingSub('sub_1', 'lead_s', 'trialing');
  h.stripe.state.subscriptions.set('sub_1', sub);
  await h.handlers['stripe-webhook'](signed(h, { id: 'evt_c', type: 'customer.subscription.created', data: { object: sub } }));
  assert.equal(h.store.ents.get('lead_s').listingAccessStatus, 'active');
  assert.equal(h.store.ents.get('lead_s').listingSubscriptionStatus, 'trialing');
  assert.deepEqual(h.emails.welcome, ['lead_s']);

  // Trial ends, first $19.99 renewal paid.
  h.stripe.state.subscriptions.set('sub_1', { ...sub, status: 'active' });
  await h.handlers['stripe-webhook'](signed(h, { id: 'evt_paid', type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1', amount_paid: 1999 } } }));
  assert.equal(h.store.ents.get('lead_s').listingAccessStatus, 'active');
  assert.deepEqual(h.funnel.filter((e) => e.event === 'subscription_paid').map((e) => e.amount), [19.99]);
  assert.deepEqual(h.emails.welcome, ['lead_s'], 'welcome email not resent');

  // Next renewal fails → past_due → no listing access.
  h.stripe.state.subscriptions.set('sub_1', { ...sub, status: 'past_due' });
  await h.handlers['stripe-webhook'](signed(h, { id: 'evt_fail', type: 'invoice.payment_failed', data: { object: { id: 'in_2', subscription: 'sub_1', amount_due: 1999 } } }));
  assert.equal(h.store.ents.get('lead_s').listingAccessStatus, 'inactive');
  assert.equal(h.funnel.filter((e) => e.event === 'subscription_payment_failed').length, 1);
});

test('AB: cancelling the listing subscription removes access; a Support membership event never touches listing access', async () => {
  const h = setup();
  const sub = listingSub('sub_l', 'lead_c', 'trialing');
  await h.handlers['stripe-webhook'](signed(h, { id: 'evt_1', type: 'customer.subscription.created', data: { object: sub } }));
  assert.equal(h.store.ents.get('lead_c').listingAccessStatus, 'active');

  const membership = { id: 'sub_m', status: 'canceled', customer: 'cus_1', metadata: { leadId: 'lead_c', plan: 'monthly' } };
  await h.handlers['stripe-webhook'](signed(h, { id: 'evt_2', type: 'customer.subscription.deleted', data: { object: membership } }));
  assert.equal(h.store.ents.get('lead_c').listingAccessStatus, 'active', 'membership cancellation leaves listing access alone');
  assert.equal(h.store.ents.get('lead_c').membershipStatus, 'inactive');
  await h.handlers['stripe-webhook'](signed(h, { id: 'evt_3', type: 'customer.subscription.updated', data: { object: { ...membership, status: 'past_due' } } }));
  assert.equal(h.store.ents.get('lead_c').listingSubscriptionId, 'sub_l');

  await h.handlers['stripe-webhook'](signed(h, { id: 'evt_4', type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } }));
  assert.equal(h.store.ents.get('lead_c').listingAccessStatus, 'inactive');
  assert.equal(h.funnel.filter((e) => e.event === 'subscription_canceled').length, 1);
});

test('legacy $10 pre-screen events still grant paid10 but never replace a saved card', async () => {
  const h = setup({ entitlements: { lead_l: { paid10: true, stripeCustomerId: 'cus_keep', defaultPaymentMethodId: 'pm_keep' } } });
  await h.handlers['stripe-webhook'](signed(h, piSucceeded('pi_old', 'lead_l', 'prescreen', 1000)));
  assert.equal(h.store.ents.get('lead_l').defaultPaymentMethodId, 'pm_keep');
  assert.equal(h.store.ents.get('lead_l').stripeCustomerId, 'cus_keep');
  assert.equal(h.stripe.state.customerUpdates.length, 0);
  assert.deepEqual(h.emails.welcome, []);
});
