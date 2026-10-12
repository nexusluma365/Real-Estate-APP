// Customer-initiated upsell payments on the production trial funnel, run
// against the real Netlify functions with an in-memory Stripe (no network,
// no real charges). Prices: $20 upsells (2000 cents), $97 Credit Kit.
const test = require('node:test');
const assert = require('assert');
const { setup, post, completeSignup } = require('./helpers/payment-harness');

const LEAD = 'lead_a';

async function member(options = {}) {
  const h = setup(options);
  const signup = await completeSignup(h, { leadId: LEAD, pm: 'pm_saved' });
  assert.equal(signup.confirmed.json.status, 'succeeded', 'trial started');
  return { h, cookie: signup.cookie };
}

function upsellCharges(h) {
  return h.stripe.state.charges.filter((c) => c.product);
}

test('G/I: one-click $20 upsell charges 2000 cents once, on-session, with production details', async () => {
  const { h, cookie } = await member();
  h.store.ents.get(LEAD).manychat_contact_id = '123456789';
  const res = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'modern' }, { cookie });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.status, 'succeeded');
  const create = h.stripe.state.createCalls.find((c) => c.params.metadata.product === 'modern');
  assert.equal(create.params.amount, 2000);
  assert.equal(create.params.currency, 'usd');
  assert.equal(create.params.off_session, undefined, 'customer-present purchase must not be off_session');
  assert.equal(create.params.customer, h.store.ents.get(LEAD).stripeCustomerId);
  assert.deepEqual(create.params.payment_method_types, ['card']);
  assert.deepEqual(create.params.payment_method_options, { card: { request_three_d_secure: 'automatic' } });
  assert.equal(create.params.description, 'RentReady Modern Apartment Matches & RentReady Guide');
  assert.match(create.opts.idempotencyKey, /^rr-upsell:v2:lead_a:modern:cus_/);
  const pi = h.stripe.state.intents.get(res.json.paymentIntentId);
  assert.equal(pi.receipt_email, 'renter@example.com');
  assert.equal(pi.metadata.manychat_contact_id, '123456789');
  assert.equal(h.stripe.state.confirmCalls.length, 1);
  assert.equal(h.stripe.state.confirmCalls[0].params.payment_method, 'pm_saved');
  assert.equal(h.stripe.state.confirmCalls[0].params.off_session, undefined);
  assert.deepEqual(upsellCharges(h).map((c) => c.amount), [2000]);

  const ent = h.store.ents.get(LEAD);
  assert.equal(ent.paid27, true);
  assert.deepEqual(ent.purchasedCategories, ['modern']);
  assert.equal(ent.productPaymentIntents.modern, res.json.paymentIntentId);
  assert.equal(ent.defaultPaymentMethodId, 'pm_saved', 'upsell never replaces the saved card');
  assert.equal(ent.listingAccessStatus, 'active', 'listing access untouched');
  assert.deepEqual(h.emails.download, [{ leadId: LEAD, product: 'modern' }]);
  assert.equal(h.funnel.filter((e) => e.event === 'upsell_paid').length, 1);
});

test('G/H: server prices — every $20 product is 2000 cents, Credit Kit 9700; browser amounts ignored', async () => {
  const { h, cookie } = await member({ focus: 'credit' });
  for (const product of ['gameplan', 'luxury', 'apartment_prep']) {
    await post(h.handlers['charge-upsell'], { leadId: LEAD, product, amount: 1 }, { cookie });
  }
  await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'creditkit', price: 1 }, { cookie });
  const amounts = Object.fromEntries(upsellCharges(h).map((c) => [c.product, c.amount]));
  assert.deepEqual(amounts, { gameplan: 2000, luxury: 2000, apartment_prep: 2000, creditkit: 9700 });
  assert.equal((await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'free' }, { cookie })).statusCode, 400);
});

test('Game Plan, Modern and Luxury are no longer charged off_session (Approval Kit already was on-session)', async () => {
  const { h, cookie } = await member();
  for (const product of ['gameplan', 'modern', 'luxury', 'apartment_prep']) {
    await post(h.handlers['charge-upsell'], { leadId: LEAD, product }, { cookie });
  }
  assert.ok(h.stripe.state.createCalls.every((c) => c.params.off_session === undefined && !c.params.confirm));
  assert.ok(h.stripe.state.confirmCalls.every((c) => c.params.off_session === undefined));
});

test('owning one apartment category neither blocks nor double-charges the other', async () => {
  const { h, cookie } = await member();
  await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'modern' }, { cookie });
  const luxury = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'luxury' }, { cookie });
  assert.equal(luxury.json.status, 'succeeded');
  assert.equal(luxury.json.alreadyOwned, undefined);
  assert.deepEqual(h.store.ents.get(LEAD).purchasedCategories, ['modern', 'luxury']);
  assert.equal(upsellCharges(h).length, 2);
});

test('M: double click → one PaymentIntent, one charge', async () => {
  const { h, cookie } = await member();
  const [a, b] = await Promise.all([
    post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'apartment_prep' }, { cookie }),
    post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'apartment_prep' }, { cookie }),
  ]);
  assert.equal(a.json.status, 'succeeded');
  assert.equal(b.json.status, 'succeeded');
  assert.equal(upsellCharges(h).length, 1);
  const prepIntents = [...h.stripe.state.intents.values()].filter((p) => p.metadata.product === 'apartment_prep');
  assert.equal(prepIntents.length, 1);
});

test('N/O: second tab, refresh and back button after success never charge again', async () => {
  const { h, cookie } = await member();
  await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'gameplan' }, { cookie });
  const tab2 = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'gameplan' }, { cookie });
  const refresh = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'gameplan' }, { cookie });
  assert.equal(tab2.json.alreadyOwned, true);
  assert.equal(refresh.json.alreadyOwned, true);
  assert.equal(upsellCharges(h).length, 1);
});

test('J: 3-D Secure → requires_action → browser authentication → server-verified grant', async () => {
  const { h, cookie } = await member();
  h.stripe.cards.pm_saved = { ...h.stripe.cards.pm_saved, behavior: 'requires_action' };
  const res = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'apartment_prep' }, { cookie });
  assert.equal(res.json.status, 'requires_action');
  assert.ok(res.json.clientSecret);
  assert.equal(res.json.amount, 2000);
  assert.equal(h.store.ents.get(LEAD).paid47, false, 'nothing granted before authentication');

  // The browser claims success before the bank finished: server refuses.
  const early = await post(h.handlers['confirm-intent'], { leadId: LEAD, paymentIntentId: res.json.paymentIntentId, product: 'apartment_prep' });
  assert.equal(early.json.status, 'requires_action');
  assert.equal(h.store.ents.get(LEAD).paid47, false);

  h.stripe.completeAction(res.json.paymentIntentId, true);
  const confirmed = await post(h.handlers['confirm-intent'], { leadId: LEAD, paymentIntentId: res.json.paymentIntentId, product: 'apartment_prep' });
  assert.equal(confirmed.json.status, 'succeeded');
  assert.equal(h.store.ents.get(LEAD).paid47, true);
  assert.deepEqual(h.emails.download, [{ leadId: LEAD, product: 'apartment_prep' }]);
});

test('K/L: insufficient_funds is reported truthfully, nothing granted, saved card not retried, another card completes the SAME purchase once', async () => {
  const { h, cookie } = await member();
  h.stripe.cards.pm_saved = { ...h.stripe.cards.pm_saved, behavior: 'insufficient_funds', funding: 'prepaid' };

  const declined = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'apartment_prep' }, { cookie });
  assert.equal(declined.statusCode, 200);
  assert.equal(declined.json.status, 'requires_payment_method');
  assert.equal(declined.json.decline.code, 'insufficient_funds');
  assert.match(declined.json.decline.message, /insufficient funds/i);
  assert.equal(declined.json.savedCard, true);
  assert.equal(declined.json.amount, 2000);
  assert.equal(JSON.stringify(declined.json).includes('pm_saved'), false, 'no payment method ids reach the browser');
  assert.equal(h.store.ents.get(LEAD).paid47, false);
  assert.deepEqual(h.emails.download, []);
  const failedRow = h.funnel.find((e) => e.event === 'upsell_failed');
  assert.deepEqual(failedRow.detail, { product: 'apartment_prep', reason: 'insufficient_funds', amount: 2000 });

  // Clicking again does not hammer the declined card, and isn't treated as abuse.
  const again = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'apartment_prep' }, { cookie });
  assert.equal(again.json.status, 'requires_payment_method');
  assert.equal(again.json.paymentIntentId, declined.json.paymentIntentId, 'same PaymentIntent');
  assert.equal(h.stripe.state.confirmCalls.length, 1);

  // A different card typed into Stripe Elements pays the SAME PaymentIntent.
  const browser = h.stripe.browserConfirm(declined.json.clientSecret, 'pm_other_card');
  assert.equal(browser.paymentIntent.status, 'succeeded');
  const confirmed = await post(h.handlers['confirm-intent'], { leadId: LEAD, paymentIntentId: declined.json.paymentIntentId, product: 'apartment_prep' });
  assert.equal(confirmed.json.status, 'succeeded');
  assert.equal(h.store.ents.get(LEAD).paid47, true);
  assert.equal(upsellCharges(h).length, 1);
  assert.equal(h.store.ents.get(LEAD).defaultPaymentMethodId, 'pm_saved', 'trial card stays the subscription card');

  // A paid PaymentIntent can't be paid again with yet another card.
  assert.ok(h.stripe.browserConfirm(declined.json.clientSecret, 'pm_third').error);
  assert.equal(upsellCharges(h).length, 1);
});

test('after a typed card fails too, the latest real decline is shown — not the saved card\'s stale reason', async () => {
  const { h, cookie } = await member();
  h.stripe.cards.pm_saved = { ...h.stripe.cards.pm_saved, behavior: 'card_declined' };
  h.stripe.cards.pm_broke = { behavior: 'insufficient_funds' };
  const first = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'apartment_prep' }, { cookie });
  assert.equal(first.json.decline.code, 'card_declined');
  h.stripe.browserConfirm(first.json.clientSecret, 'pm_broke');
  const again = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'apartment_prep' }, { cookie });
  assert.equal(again.json.decline.code, 'insufficient_funds');
  assert.equal(again.json.paymentIntentId, first.json.paymentIntentId);
  assert.equal(h.stripe.state.confirmCalls.length, 1, 'saved card not retried');
  assert.equal(upsellCharges(h).length, 0);
});

test('decline categories are kept distinct; API errors are never reported as bank declines', async () => {
  const cases = [
    ['card_declined', 'card_declined'],
    ['generic_decline', 'card_declined'],
    ['stolen_card', 'card_declined'],
    ['expired_card', 'expired_card'],
    ['incorrect_cvc', 'incorrect_cvc'],
    ['processing_error', 'processing_error'],
  ];
  for (const [behavior, code] of cases) {
    const { h, cookie } = await member();
    h.stripe.cards.pm_saved = { ...h.stripe.cards.pm_saved, behavior };
    const res = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'gameplan' }, { cookie });
    assert.equal(res.json.decline.code, code, behavior);
    assert.equal(h.store.ents.get(LEAD).paidGameplan, undefined);
  }

  const { h, cookie } = await member();
  h.stripe.paymentIntents.create = async () => {
    const err = new Error('An error occurred with our connection to Stripe.');
    err.type = 'StripeConnectionError';
    throw err;
  };
  const apiDown = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'gameplan' }, { cookie });
  assert.equal(apiDown.statusCode, 500);
  assert.equal(apiDown.json.code, 'stripe_error');
  assert.doesNotMatch(apiDown.json.error, /declined|funds/i);
});

test('P: someone holding only the leadId cannot charge the saved card', async () => {
  const { h } = await member();
  const confirmsBefore = h.stripe.state.confirmCalls.length;

  const attack = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'modern' });
  assert.equal(attack.json.status, 'requires_payment_method', 'only a card-entry form is offered');
  assert.equal(attack.json.savedCard, false);
  assert.equal(h.stripe.state.confirmCalls.length, confirmsBefore, 'saved card never used');
  assert.equal(h.stripe.state.intents.get(attack.json.paymentIntentId).customer, null, 'guest PaymentIntent not attached to the customer');
  assert.ok(h.stripe.browserConfirm(attack.json.clientSecret, 'pm_saved').error, 'saved card unusable on a guest PaymentIntent');
  assert.equal(upsellCharges(h).length, 0);

  // Forged and cross-lead cookies are ignored.
  const forged = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'modern' }, { cookie: 'rr_session=eyJsZWFkSWQiOiJsZWFkX2EifQ.fake' });
  assert.equal(forged.json.savedCard, false);
  const { sessionCookie } = require('../netlify/functions/_lib/session');
  const otherSetup = sessionCookie({ leadId: LEAD, si: 'seti_attacker' }).split(';')[0];
  assert.equal((await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'modern' }, { cookie: otherSetup })).json.savedCard, false);
  const otherLead = sessionCookie({ leadId: 'lead_attacker', si: h.store.ents.get(LEAD).cardSetupIntentId }).split(';')[0];
  assert.equal((await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'modern' }, { cookie: otherLead })).json.savedCard, false);
  assert.equal(h.stripe.state.confirmCalls.length, confirmsBefore);
});

test('a duplicate payment for an owned product is refunded (rentready_reason: duplicate_purchase); other products are not', async () => {
  const { h, cookie } = await member();
  const guest = await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'luxury' });
  await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'luxury' }, { cookie });
  await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'modern' }, { cookie });
  h.stripe.browserConfirm(guest.json.clientSecret, 'pm_other');
  const res = await post(h.handlers['confirm-intent'], { leadId: LEAD, paymentIntentId: guest.json.paymentIntentId, product: 'luxury' });
  assert.equal(res.json.status, 'succeeded');
  assert.deepEqual(h.stripe.state.refunds, [{
    paymentIntent: guest.json.paymentIntentId,
    metadata: { leadId: LEAD, product: 'luxury', rentready_reason: 'duplicate_purchase' },
  }]);
  assert.equal(h.emails.download.filter((e) => e.product === 'luxury').length, 1);
  assert.equal(h.funnel.filter((e) => e.event === 'upsell_paid' && e.detail.product === 'luxury').length, 1);
});

test('upsells require an active listing checkout first', async () => {
  const h = setup();
  const res = await post(h.handlers['charge-upsell'], { leadId: 'lead_unpaid', product: 'modern' });
  assert.equal(res.statusCode, 403);
  assert.equal(h.stripe.state.createCalls.length, 0);
});

test('rate limiting brakes automated hammering but never blocks the card form', async () => {
  const { h, cookie } = await member();
  const results = [];
  for (let i = 0; i < 17; i += 1) results.push(await post(h.handlers['charge-upsell'], { leadId: LEAD, product: 'modern' }, { cookie }));
  assert.equal(results[0].json.status, 'succeeded');
  assert.equal(results[results.length - 1].statusCode, 429);
  assert.equal(upsellCharges(h).length, 1);
});
