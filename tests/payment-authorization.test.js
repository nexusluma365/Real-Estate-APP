// Production trial signup + authorization rules, against the real functions
// with an in-memory Stripe: $0 SetupIntent → card saved → 7-day trial on the
// $19.99/month Price, plus who may charge the saved card, change a lead, or
// change a Stripe customer.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { setup, post, cookieFrom, completeSignup, LISTING_PRICE_ID } = require('./helpers/payment-harness');

test('A–F: new lead → $0 SetupIntent → card saved → exactly 7-day trial on the $19.99/month Price', async () => {
  const h = setup();
  const { cookie, submitted, intent, confirmed } = await completeSignup(h, { leadId: 'lead_new', pm: 'pm_card' });

  // A. New lead created, and this browser gets an HttpOnly session.
  assert.equal(submitted.json.saved, true);
  assert.equal(h.store.leadMap.get('lead_new').email, 'renter@example.com');
  assert.match(submitted.headers['Set-Cookie'], /^rr_session=.+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/);

  // B. A SetupIntent ($0 due today), not a PaymentIntent.
  assert.equal(intent.json.intentType, 'setup');
  assert.match(intent.json.setupIntentId, /^seti_/);
  assert.equal(h.stripe.state.setupIntentsCreated[0].usage, 'off_session');
  assert.deepEqual(h.stripe.state.setupIntentsCreated[0].payment_method_types, ['card']);
  assert.equal(h.stripe.state.createCalls.length, 0, 'no PaymentIntent (no charge, no $1 hold) at signup');
  assert.ok(cookie.startsWith('rr_session='));

  // C. Card saved.  D/E/F. Subscription with a 7-day trial on the $19.99 Price.
  assert.equal(confirmed.json.status, 'succeeded');
  assert.equal(confirmed.json.subscriptionStatus, 'trialing');
  const sub = h.stripe.state.subscriptionsCreated[0];
  assert.equal(h.stripe.state.subscriptionsCreated.length, 1);
  assert.equal(sub.params.trial_period_days, 7);
  assert.deepEqual(sub.params.items, [{ price: LISTING_PRICE_ID }]);
  assert.equal(sub.params.default_payment_method, 'pm_card');
  assert.equal(sub.opts.idempotencyKey, 'lead_new:listing-subscription:trial-1999-v4');
  assert.equal(confirmed.json.subscriptionAmount, 19.99);
  assert.equal(h.stripe.state.charges.length, 0, 'nothing charged today');

  const ent = h.store.ents.get('lead_new');
  assert.equal(ent.paid10, true);
  assert.equal(ent.listingAccessStatus, 'active');
  assert.equal(ent.defaultPaymentMethodId, 'pm_card');
  assert.equal(ent.cardSetupIntentId, intent.json.setupIntentId);
  assert.deepEqual(h.emails.welcome, ['lead_new']);
  assert.equal(/cus_|pm_/.test(confirmed.body), false, 'no Stripe ids returned to the browser');
  // Z. Server-side funnel tracking: trial_started once.
  assert.deepEqual(h.funnel.map((e) => e.event), ['trial_started']);
});

test('the $19.99 Price check follows the Stripe key mode (test key → test Price, live key → live Price)', async () => {
  const h = setup();
  process.env.STRIPE_SECRET_KEY = 'sk_live_harness_not_real';
  const { confirmed } = await completeSignup(h, { leadId: 'lead_mode' });
  assert.equal(confirmed.statusCode, 500);
  assert.match(confirmed.json.error, /live-mode Stripe Price/);
  assert.equal(h.stripe.state.subscriptionsCreated.length, 0);
});

test('AC/AD/AE: prepaid and debit cards are accepted at signup and for upsells; no $1 authorization exists', async () => {
  for (const funding of ['prepaid', 'debit']) {
    const h = setup({ cards: { pm_card: { behavior: 'success', funding } } });
    const { cookie, confirmed } = await completeSignup(h, { leadId: `lead_${funding}`, pm: 'pm_card' });
    assert.equal(confirmed.json.status, 'succeeded', `${funding} trial starts`);
    assert.equal(h.stripe.state.createCalls.length, 0, 'no authorization hold at signup');
    const upsell = await post(h.handlers['charge-upsell'], { leadId: `lead_${funding}`, product: 'modern' }, { cookie });
    assert.equal(upsell.json.status, 'succeeded', `${funding} upsell`);
    assert.deepEqual(h.stripe.state.charges.map((c) => [c.amount, c.funding]), [[2000, funding]]);
  }
  const source = fs.readdirSync(path.join(__dirname, '../netlify/functions'), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(__dirname, '../netlify/functions', f), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /capture_method\s*:\s*['"]manual/, 'no authorization-and-release charge anywhere');
  assert.doesNotMatch(source, /funding\s*===?\s*['"]prepaid['"]/, 'no prepaid blocking');
});

test('AF/AG: no $10 checkout and no $27/$47 prices exist in the payment code', () => {
  const { PRODUCTS } = require('../netlify/functions/_lib/products');
  assert.deepEqual(Object.fromEntries(Object.entries(PRODUCTS).map(([k, v]) => [k, v.amount])), {
    gameplan: 2000, modern: 2000, luxury: 2000, apartment_prep: 2000, creditkit: 9700,
  });
  const files = ['create-payment-intent.js', 'charge-upsell.js', 'confirm-intent.js', '_lib/products.js'];
  for (const file of files) {
    const src = fs.readFileSync(path.join(__dirname, '../netlify/functions', file), 'utf8');
    assert.doesNotMatch(src, /amount:\s*(1000|2700|4700)\b/, file);
  }
  const createIntent = fs.readFileSync(path.join(__dirname, '../netlify/functions/create-payment-intent.js'), 'utf8');
  assert.doesNotMatch(createIntent, /paymentIntents\.create/, 'signup never creates a PaymentIntent');
});

test('same browser reuses its own SetupIntent; another browser never receives it', async () => {
  const h = setup();
  const submitted = await post(h.handlers['submit-lead'], { lead_id: 'lead_r', email: 'r@example.com' });
  let cookie = cookieFrom(submitted);
  const first = await post(h.handlers['create-payment-intent'], { leadId: 'lead_r', email: 'r@example.com' }, { cookie });
  cookie = cookieFrom(first);
  const again = await post(h.handlers['create-payment-intent'], { leadId: 'lead_r', email: 'r@example.com' }, { cookie });
  assert.equal(again.json.setupIntentId, first.json.setupIntentId);
  const stranger = await post(h.handlers['create-payment-intent'], { leadId: 'lead_r', email: 'r@example.com' });
  assert.notEqual(stranger.json.clientSecret, first.json.clientSecret, 'a leadId alone never yields the victim\'s client secret');
});

test('active members: no second SetupIntent, no second subscription, retries of the same checkout still succeed', async () => {
  const h = setup();
  const { cookie, intent } = await completeSignup(h, { leadId: 'lead_m' });
  // Checkout page retry (confirmSubscriptionWithRetry) for the same SetupIntent.
  const retry = await post(h.handlers['confirm-intent'], { leadId: 'lead_m', setupIntentId: intent.json.setupIntentId, product: 'prescreen' }, { cookie });
  assert.equal(retry.json.status, 'succeeded');
  assert.equal(retry.json.subscriptionStatus, 'trialing');
  assert.ok(retry.json.subscriptionId);
  // Re-opening checkout as a member.
  const reopen = await post(h.handlers['create-payment-intent'], { leadId: 'lead_m', email: 'renter@example.com' }, { cookie });
  assert.equal(reopen.json.alreadyActive, true);
  assert.equal(h.stripe.state.setupIntentsCreated.length, 1);
  assert.equal(h.stripe.state.subscriptionsCreated.length, 1);
  assert.deepEqual(h.emails.welcome, ['lead_m']);
  assert.equal(h.funnel.filter((e) => e.event === 'trial_started').length, 1, 'a retry does not log a second trial');
});

test('S: a leadId alone cannot modify or replace the Stripe customer, saved card, access or subscription', async () => {
  const h = setup();
  await completeSignup(h, { leadId: 'lead_v', pm: 'pm_victim' });
  const before = { ...h.store.ents.get('lead_v') };
  const updatesBefore = h.stripe.state.customerUpdates.length;

  // Attacker restarts checkout for the victim's lead.
  const attack = await post(h.handlers['create-payment-intent'], {
    leadId: 'lead_v',
    email: 'attacker@example.com',
    answers: { email: 'attacker@example.com', first_name: 'Mallory', stripeCustomerId: 'cus_evil', listingAccessStatus: 'active' },
  });
  assert.equal(attack.json.alreadyActive, true);
  assert.equal(attack.headers['Set-Cookie'], undefined);
  assert.equal(h.stripe.state.customerUpdates.length, updatesBefore, 'customer email/name untouched');
  assert.equal(h.store.leadMap.get('lead_v').email, 'renter@example.com');
  const after = h.store.ents.get('lead_v');
  for (const field of ['stripeCustomerId', 'defaultPaymentMethodId', 'cardSetupIntentId', 'listingSubscriptionId', 'listingAccessStatus', 'listingSubscriptionStatus']) {
    assert.equal(after[field], before[field], field);
  }
});

test('S: on a lapsed lead, a stranger\'s SetupIntent cannot replace the saved card or edit the customer', async () => {
  const h = setup();
  await completeSignup(h, { leadId: 'lead_lapsed', pm: 'pm_victim' });
  Object.assign(h.store.ents.get('lead_lapsed'), { listingSubscriptionStatus: 'canceled', listingAccessStatus: 'inactive' });
  const updatesBefore = h.stripe.state.customerUpdates.length;

  const attackerIntent = await post(h.handlers['create-payment-intent'], { leadId: 'lead_lapsed', email: 'attacker@example.com', answers: { email: 'attacker@example.com' } });
  assert.equal(h.stripe.state.customerUpdates.length, updatesBefore, 'existing customer not edited without the session');
  h.stripe.browserConfirmSetup(attackerIntent.json.clientSecret, 'pm_attacker');
  const hijack = await post(h.handlers['confirm-intent'], { leadId: 'lead_lapsed', setupIntentId: attackerIntent.json.setupIntentId, product: 'prescreen' });
  assert.equal(hijack.statusCode, 403);
  assert.equal(h.store.ents.get('lead_lapsed').defaultPaymentMethodId, 'pm_victim');
});

test('Q: an email lookup never reveals another customer\'s lead or lead_id', async () => {
  const h = setup({ leads: { lead_victim: { email: 'victim@example.com', phone: '555-0100', preferred_city: 'Austin, TX' } } });
  const res = await post(h.handlers['submit-lead'], { lookupOnly: true, email: 'victim@example.com' });
  assert.equal(res.json.registered, false);
  assert.equal(res.body.includes('lead_victim'), false);
  assert.equal(res.body.includes('555-0100'), false);
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('R: an unauthenticated submit-lead cannot overwrite a lead or set server-owned fields', async () => {
  const h = setup({ leads: { lead_victim: { email: 'victim@example.com', preferred_city: 'Austin, TX' } } });
  const res = await post(h.handlers['submit-lead'], {
    lead_id: 'lead_victim',
    email: 'attacker@example.com',
    paid10: true,
    stripeCustomerId: 'cus_attacker',
    listingAccessStatus: 'active',
  });
  assert.equal(res.json.saved, false);
  assert.equal(h.store.leadMap.get('lead_victim').email, 'victim@example.com');
  assert.equal(h.store.savedLeads.length, 0);

  const fresh = await post(h.handlers['submit-lead'], {
    lead_id: 'lead_fresh', email: 'fresh@example.com', paid10: true, stripeCustomerId: 'cus_x',
    listingAccessStatus: 'active', defaultPaymentMethodId: 'pm_x', cardSetupIntentId: 'seti_x',
  });
  assert.equal(fresh.json.saved, true);
  const saved = h.store.leadMap.get('lead_fresh');
  for (const field of ['paid10', 'stripeCustomerId', 'listingAccessStatus', 'defaultPaymentMethodId', 'cardSetupIntentId']) {
    assert.equal(saved[field], undefined, field);
  }
  assert.equal(h.store.patches.length, 0, 'submit-lead never writes entitlements');

  // The owner (same browser) keeps editing their own answers.
  const update = await post(h.handlers['submit-lead'], { lead_id: 'lead_fresh', email: 'fresh@example.com', preferred_city: 'Dallas, TX' }, { cookie: cookieFrom(fresh) });
  assert.equal(update.json.saved, true);
  assert.equal(h.store.leadMap.get('lead_fresh').preferred_city, 'Dallas, TX');
});

test('Support membership subscriptions need the verified payer; double clicks create one', async () => {
  process.env.STRIPE_PRICE_MONTHLY = 'price_support_monthly';
  const h = setup();
  const { cookie } = await completeSignup(h, { leadId: 'lead_sup' });
  assert.equal((await post(h.handlers['create-subscription'], { leadId: 'lead_sup', plan: 'monthly' })).statusCode, 403);
  const listingSubs = h.stripe.state.subscriptionsCreated.length;
  await Promise.all([
    post(h.handlers['create-subscription'], { leadId: 'lead_sup', plan: 'monthly' }, { cookie }),
    post(h.handlers['create-subscription'], { leadId: 'lead_sup', plan: 'monthly' }, { cookie }),
  ]);
  assert.equal(h.stripe.state.subscriptionsCreated.length, listingSubs + 1);
});

test('W: Game Plan ownership is separate from the apartment lists (paid27)', async () => {
  const h = setup({
    entitlements: {
      lead_gp: { paid10: true, paidGameplan: true },
      lead_apt: { paid10: true, paid27: true, purchasedCategories: ['luxury'] },
      lead_legacy_gp: { paid10: true, paid27: true, purchasedCategories: [] },
    },
  });
  const read = async (leadId) => JSON.parse((await h.handlers['get-entitlements']({ httpMethod: 'GET', queryStringParameters: { leadId } })).body);
  assert.equal((await read('lead_gp')).paidGameplan, true);
  assert.equal((await read('lead_apt')).paidGameplan, false, 'buying Luxury no longer unlocks the Game Plan');
  assert.equal((await read('lead_apt')).paid27, true);
  assert.equal((await read('lead_legacy_gp')).paidGameplan, true, 'legacy Game Plan buyers keep it');

  const { ownsProduct } = require('../netlify/functions/_lib/products');
  assert.equal(ownsProduct({ paidGameplan: true }, 'modern'), false, 'Game Plan does not block buying apartment matches');
});

test('X: existing members (before this release) keep access and are never locked out of buying', async () => {
  const h = setup({
    entitlements: {
      lead_old: {
        paid10: true, paid27: true, purchasedCategories: [], stripeCustomerId: 'cus_old', defaultPaymentMethodId: 'pm_old',
        listingSubscriptionId: 'sub_old', listingSubscriptionStatus: 'trialing', listingAccessStatus: 'active',
      },
    },
    leads: { lead_old: { email: 'old@example.com' } },
  });
  assert.equal((await post(h.handlers['charge-upsell'], { leadId: 'lead_old', product: 'gameplan' })).json.alreadyOwned, true);
  const modern = await post(h.handlers['charge-upsell'], { leadId: 'lead_old', product: 'modern' });
  assert.equal(modern.json.status, 'requires_payment_method', 'no session yet → card form, not a lockout');
  h.stripe.browserConfirm(modern.json.clientSecret, 'pm_typed');
  await post(h.handlers['confirm-intent'], { leadId: 'lead_old', paymentIntentId: modern.json.paymentIntentId, product: 'modern' });
  const after = h.store.ents.get('lead_old');
  assert.deepEqual(after.purchasedCategories, ['modern']);
  assert.equal(after.paidGameplan, true, 'legacy Game Plan preserved when a category is added');
  assert.equal(after.defaultPaymentMethodId, 'pm_old');
  assert.equal(after.listingAccessStatus, 'active');
});

test('downloads: a bare ?leadId= needs the owning session; Game Plan PDF is not unlocked by apartment purchases', async () => {
  const h = setup({ entitlements: { lead_d: { paid10: true, paid27: true, purchasedCategories: ['modern'] } } });
  const get = (qs, cookie) => h.handlers['download-file']({ httpMethod: 'GET', headers: cookie ? { cookie } : {}, queryStringParameters: qs });
  assert.equal((await get({ leadId: 'lead_d', product: 'gameplan' })).statusCode, 403);
  const owner = require('../netlify/functions/_lib/session').sessionCookie({ leadId: 'lead_d' }).split(';')[0];
  assert.equal((await get({ leadId: 'lead_d', product: 'gameplan' }, owner)).statusCode, 403);
});

test('session tokens: tampering, expiry and cross-purpose replay are rejected', () => {
  const { sign, verify } = require('../netlify/functions/_lib/sign');
  const { readSession, sessionCookie } = require('../netlify/functions/_lib/session');
  const event = (cookie) => ({ headers: { cookie } });
  const good = sessionCookie({ leadId: 'lead_s', si: 'seti_s' }).split(';')[0];
  assert.deepEqual(readSession(event(good)), { leadId: 'lead_s', si: 'seti_s' });
  const [name, value] = good.split('=');
  const [, mac] = decodeURIComponent(value).split('.');
  const forgedBody = Buffer.from(JSON.stringify({ leadId: 'lead_other', si: 'seti_s', exp: Date.now() + 1e6 })).toString('base64url');
  assert.equal(readSession(event(`${name}=${forgedBody}.${mac}`)), null);
  assert.equal(readSession(event(`${name}=garbage`)), null);
  // An emailed return-link token can't be used as a session, nor vice versa.
  const emailToken = sign({ leadId: 'lead_s', product: 'apartment-results' });
  assert.equal(readSession(event(`rr_session=${encodeURIComponent(emailToken)}`)), null);
  assert.equal(verify(decodeURIComponent(value)), null);
  assert.equal(readSession(event(`rr_session=${encodeURIComponent(sign({ leadId: 'lead_s' }, -1000, { purpose: 'session' }))}`)), null);
});
