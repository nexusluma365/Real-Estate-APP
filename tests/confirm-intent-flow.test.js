const assert = require('assert');
const { withSession, sessionFromSetCookie } = require('./_session-helper');

async function loadHandler({ paymentIntent, setupIntent, subscription, price, priceError, patchEntitlements, customerUpdate, entitlements, sendWelcomeEmail, sendDownloadEmail, cardFunding = 'credit', cardCheck, session = 'auto' }) {
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const welcomeEmailPath = require.resolve('../netlify/functions/_lib/welcome-email');
  const downloadEmailPath = require.resolve('../netlify/functions/_lib/download-email');
  const fnPath = require.resolve('../netlify/functions/confirm-intent');
  delete require.cache[fnPath];

  const welcomeEmailCalls = [];
  const downloadEmailCalls = [];
  const subscriptionCreateCalls = [];
  const cardCheckCalls = [];
  const cancelCalls = [];
  const detachCalls = [];

  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      getStripe: () => ({
        paymentIntents: {
          retrieve: async () => paymentIntent,
          create: async (payload, options) => {
            cardCheckCalls.push({ payload, options });
            if (cardCheck && cardCheck.error) throw cardCheck.error;
            return (cardCheck && cardCheck.intent) || { id: 'pi_card_check', status: 'requires_capture' };
          },
          cancel: async (id) => {
            cancelCalls.push(id);
            return { id, status: 'canceled' };
          },
        },
        paymentMethods: {
          retrieve: async (id) => ({ id, card: { funding: cardFunding } }),
          detach: async (id) => {
            detachCalls.push(id);
            return { id };
          },
        },
        setupIntents: {
          retrieve: async () => setupIntent,
        },
        prices: {
          retrieve: async () => {
            if (priceError) throw priceError;
            return price || { id: 'price_1999_monthly', active: true, livemode: true, currency: 'usd', unit_amount: 1999, recurring: { interval: 'month' } };
          },
        },
        subscriptions: {
          create: async (payload, options) => {
            subscriptionCreateCalls.push({ payload, options });
            return subscription;
          },
        },
        customers: {
          update: customerUpdate || (async () => ({})),
        },
      }),
    },
  };
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getEntitlements: async () => entitlements || { paid10: false },
      patchEntitlements,
    },
  };
  require.cache[welcomeEmailPath] = {
    id: welcomeEmailPath,
    filename: welcomeEmailPath,
    loaded: true,
    exports: {
      sendWelcomeEmail:
        sendWelcomeEmail ||
        (async (leadId) => {
          welcomeEmailCalls.push(leadId);
        }),
    },
  };
  require.cache[downloadEmailPath] = {
    id: downloadEmailPath,
    filename: downloadEmailPath,
    loaded: true,
    exports: {
      sendDownloadEmail:
        sendDownloadEmail ||
        (async (leadId, product) => {
          downloadEmailCalls.push({ leadId, product });
          return true;
        }),
    },
  };

  const rawHandler = require('../netlify/functions/confirm-intent').handler;
  // By default each call carries a session cookie for the lead it names
  // (what the real checkout page has after submit-lead / charge-upsell).
  const handler = (event) => {
    if (!session) return rawHandler(event);
    const bodyLead = JSON.parse(event.body || '{}').leadId;
    const product = JSON.parse(event.body || '{}').product;
    const s = session === 'auto' ? { leadId: bodyLead, scope: product === 'prescreen' ? 'lead' : 'paid' } : session;
    return rawHandler(withSession(event, s.leadId, s.scope));
  };
  return { handler, welcomeEmailCalls, downloadEmailCalls, subscriptionCreateCalls, cardCheckCalls, cancelCalls, detachCalls };
}

async function run() {
  process.env.STRIPE_LISTING_PRICE_MONTHLY = 'price_1999_monthly';
  const succeededIntent = {
    id: 'pi_test',
    status: 'succeeded',
    metadata: { leadId: 'lead_123' },
    customer: 'cus_test',
    payment_method: 'pm_test',
  };

  const { handler } = await loadHandler({
    paymentIntent: succeededIntent,
    entitlements: { paid10: false },
    patchEntitlements: async () => {
      throw new Error('temporary entitlement write failure');
    },
    customerUpdate: async () => {
      throw new Error('temporary customer update failure');
    },
  });

  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      leadId: 'lead_123',
      paymentIntentId: 'pi_test',
      product: 'prescreen',
    }),
  });
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, 'succeeded');
  assert.match(body.warning, /could not be saved/i);

  const setupTrial = await loadHandler({
    setupIntent: {
      id: 'seti_test',
      status: 'succeeded',
      metadata: { leadId: 'lead_setup', product: 'listing_membership' },
      customer: 'cus_setup',
      payment_method: 'pm_setup',
    },
    subscription: {
      id: 'sub_setup',
      status: 'trialing',
      current_period_start: 1800000000,
      current_period_end: 1800604800,
      cancel_at_period_end: false,
    },
    entitlements: { paid10: false },
    patchEntitlements: async (_leadId, patch) => patch,
  });
  const setupRes = await setupTrial.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_setup', setupIntentId: 'seti_test', product: 'prescreen' }),
  });
  const setupBody = JSON.parse(setupRes.body);
  assert.equal(setupRes.statusCode, 200);
  assert.equal(setupBody.ok, true);
  assert.equal(setupBody.status, 'succeeded');
  assert.equal(setupBody.subscriptionId, 'sub_setup');
  assert.equal(setupBody.subscriptionStatus, 'trialing');
  assert.deepEqual(setupTrial.welcomeEmailCalls, ['lead_setup']);
  assert.equal(setupTrial.subscriptionCreateCalls.length, 1);
  assert.deepEqual(setupTrial.subscriptionCreateCalls[0].payload.items, [{ price: 'price_1999_monthly' }]);
  assert.equal(setupTrial.subscriptionCreateCalls[0].payload.trial_period_days, 7);
  assert.equal(setupTrial.subscriptionCreateCalls[0].payload.customer, 'cus_setup');
  assert.equal(setupTrial.subscriptionCreateCalls[0].payload.default_payment_method, 'pm_setup');
  assert.deepEqual(setupTrial.subscriptionCreateCalls[0].payload.payment_settings, {
    save_default_payment_method: 'on_subscription',
    payment_method_types: ['card'],
  });
  assert.equal(setupTrial.subscriptionCreateCalls[0].options.idempotencyKey, 'lead_setup:listing-subscription:trial-1999:seti_test');
  // Card screening ran: $1 authorization placed on-session, then released.
  assert.equal(setupTrial.cardCheckCalls.length, 1);
  assert.equal(setupTrial.cardCheckCalls[0].payload.amount, 100);
  assert.equal(setupTrial.cardCheckCalls[0].payload.capture_method, 'manual');
  assert.equal(setupTrial.cardCheckCalls[0].payload.off_session, undefined);
  assert.equal(setupTrial.cardCheckCalls[0].payload.metadata.product, 'trial_card_check');
  assert.deepEqual(setupTrial.cancelCalls, ['pi_card_check']);
  // ...and the browser is upgraded to a 'paid' session for one-click upsells.
  const issued = sessionFromSetCookie(setupRes);
  assert.equal(issued.leadId, 'lead_setup');
  assert.equal(issued.scope, 'paid');

  const inactiveTrial = await loadHandler({
    setupIntent: {
      id: 'seti_incomplete',
      status: 'succeeded',
      metadata: { leadId: 'lead_incomplete', product: 'listing_membership' },
      customer: 'cus_incomplete',
      payment_method: 'pm_incomplete',
    },
    subscription: {
      id: 'sub_incomplete',
      status: 'incomplete',
      current_period_start: 1800000000,
      current_period_end: 1800604800,
      cancel_at_period_end: false,
    },
    entitlements: { paid10: false },
    patchEntitlements: async () => {
      throw new Error('should not grant access for incomplete subscriptions');
    },
  });
  const inactiveRes = await inactiveTrial.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_incomplete', setupIntentId: 'seti_incomplete', product: 'prescreen' }),
  });
  const inactiveBody = JSON.parse(inactiveRes.body);
  assert.equal(inactiveRes.statusCode, 200);
  assert.equal(inactiveBody.ok, true);
  assert.equal(inactiveBody.status, 'incomplete');
  assert.equal(inactiveBody.subscriptionId, 'sub_incomplete');
  assert.equal(inactiveBody.subscriptionStatus, 'incomplete');

  process.env.STRIPE_LISTING_PRICE_MONTHLY = 'prod_VO3S1xyfCMGZQE';
  const productIdConfig = await loadHandler({
    setupIntent: {
      id: 'seti_bad_config',
      status: 'succeeded',
      metadata: { leadId: 'lead_bad_config', product: 'listing_membership' },
      customer: 'cus_bad_config',
      payment_method: 'pm_bad_config',
    },
    subscription: { id: 'sub_should_not_create', status: 'trialing' },
    entitlements: { paid10: false },
    patchEntitlements: async (_leadId, patch) => patch,
  });
  const productIdConfigRes = await productIdConfig.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_bad_config', setupIntentId: 'seti_bad_config', product: 'prescreen' }),
  });
  assert.equal(productIdConfigRes.statusCode, 500);
  assert.match(JSON.parse(productIdConfigRes.body).error, /price_/i);
  assert.equal(productIdConfig.subscriptionCreateCalls.length, 0);
  process.env.STRIPE_LISTING_PRICE_MONTHLY = 'price_1999_monthly';

  const oneTimePriceConfig = await loadHandler({
    setupIntent: {
      id: 'seti_one_time_price',
      status: 'succeeded',
      metadata: { leadId: 'lead_one_time_price', product: 'listing_membership' },
      customer: 'cus_one_time_price',
      payment_method: 'pm_one_time_price',
    },
    price: { id: 'price_one_time', active: true, livemode: true, currency: 'usd', unit_amount: 1999, recurring: null },
    subscription: { id: 'sub_should_not_create', status: 'trialing' },
    entitlements: { paid10: false },
    patchEntitlements: async (_leadId, patch) => patch,
  });
  const oneTimePriceRes = await oneTimePriceConfig.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_one_time_price', setupIntentId: 'seti_one_time_price', product: 'prescreen' }),
  });
  assert.equal(oneTimePriceRes.statusCode, 500);
  assert.match(JSON.parse(oneTimePriceRes.body).error, /recurring monthly Price/i);
  assert.equal(oneTimePriceConfig.subscriptionCreateCalls.length, 0);

  const inactivePriceConfig = await loadHandler({
    setupIntent: {
      id: 'seti_inactive_price',
      status: 'succeeded',
      metadata: { leadId: 'lead_inactive_price', product: 'listing_membership' },
      customer: 'cus_inactive_price',
      payment_method: 'pm_inactive_price',
    },
    price: { id: 'price_inactive', active: false, livemode: true, currency: 'usd', unit_amount: 1999, recurring: { interval: 'month' } },
    subscription: { id: 'sub_should_not_create', status: 'trialing' },
    entitlements: { paid10: false },
    patchEntitlements: async (_leadId, patch) => patch,
  });
  const inactivePriceRes = await inactivePriceConfig.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_inactive_price', setupIntentId: 'seti_inactive_price', product: 'prescreen' }),
  });
  assert.equal(inactivePriceRes.statusCode, 500);
  assert.match(JSON.parse(inactivePriceRes.body).error, /inactive Stripe Price/i);
  assert.equal(inactivePriceConfig.subscriptionCreateCalls.length, 0);

  const wrongModePriceConfig = await loadHandler({
    setupIntent: {
      id: 'seti_wrong_mode_price',
      status: 'succeeded',
      metadata: { leadId: 'lead_wrong_mode_price', product: 'listing_membership' },
      customer: 'cus_wrong_mode_price',
      payment_method: 'pm_wrong_mode_price',
    },
    priceError: new Error('No such price: price_test_from_other_mode'),
    subscription: { id: 'sub_should_not_create', status: 'trialing' },
    entitlements: { paid10: false },
    patchEntitlements: async (_leadId, patch) => patch,
  });
  const wrongModePriceRes = await wrongModePriceConfig.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_wrong_mode_price', setupIntentId: 'seti_wrong_mode_price', product: 'prescreen' }),
  });
  assert.equal(wrongModePriceRes.statusCode, 500);
  assert.match(JSON.parse(wrongModePriceRes.body).error, /account\/mode/i);
  assert.equal(wrongModePriceConfig.subscriptionCreateCalls.length, 0);

  const testModePriceConfig = await loadHandler({
    setupIntent: {
      id: 'seti_test_mode_price',
      status: 'succeeded',
      metadata: { leadId: 'lead_test_mode_price', product: 'listing_membership' },
      customer: 'cus_test_mode_price',
      payment_method: 'pm_test_mode_price',
    },
    price: { id: 'price_test_mode', active: true, livemode: false, currency: 'usd', unit_amount: 1999, recurring: { interval: 'month' } },
    subscription: { id: 'sub_should_not_create', status: 'trialing' },
    entitlements: { paid10: false },
    patchEntitlements: async (_leadId, patch) => patch,
  });
  const testModePriceRes = await testModePriceConfig.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_test_mode_price', setupIntentId: 'seti_test_mode_price', product: 'prescreen' }),
  });
  assert.equal(testModePriceRes.statusCode, 500);
  assert.match(JSON.parse(testModePriceRes.body).error, /live-mode Stripe Price/i);
  assert.equal(testModePriceConfig.subscriptionCreateCalls.length, 0);

  // With a test secret key, a test-mode Price is the correct configuration
  // (staging / Stripe test cards), and a live Price is the mismatch.
  const previousKey = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
  try {
    const testKeyConfig = await loadHandler({
      setupIntent: {
        id: 'seti_test_key',
        status: 'succeeded',
        metadata: { leadId: 'lead_test_key', product: 'listing_membership' },
        customer: 'cus_test_key',
        payment_method: 'pm_test_key',
      },
      price: { id: 'price_test_mode', active: true, livemode: false, currency: 'usd', unit_amount: 1999, recurring: { interval: 'month' } },
      subscription: { id: 'sub_test_key', status: 'trialing' },
      entitlements: { paid10: false },
      patchEntitlements: async (_leadId, patch) => patch,
    });
    const testKeyRes = await testKeyConfig.handler({
      httpMethod: 'POST',
      body: JSON.stringify({ leadId: 'lead_test_key', setupIntentId: 'seti_test_key', product: 'prescreen' }),
    });
    assert.equal(testKeyRes.statusCode, 200);
    assert.equal(JSON.parse(testKeyRes.body).status, 'succeeded');
    assert.equal(testKeyConfig.subscriptionCreateCalls.length, 1);

    const liveKeyMismatch = await loadHandler({
      setupIntent: {
        id: 'seti_live_price_test_key',
        status: 'succeeded',
        metadata: { leadId: 'lead_live_price_test_key', product: 'listing_membership' },
        customer: 'cus_live_price_test_key',
        payment_method: 'pm_live_price_test_key',
      },
      subscription: { id: 'sub_should_not_create', status: 'trialing' },
      entitlements: { paid10: false },
      patchEntitlements: async (_leadId, patch) => patch,
    });
    const mismatchRes = await liveKeyMismatch.handler({
      httpMethod: 'POST',
      body: JSON.stringify({ leadId: 'lead_live_price_test_key', setupIntentId: 'seti_live_price_test_key', product: 'prescreen' }),
    });
    assert.equal(mismatchRes.statusCode, 500);
    assert.match(JSON.parse(mismatchRes.body).error, /test-mode Stripe Price/i);
  } finally {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
  }

  const wrongAmountPriceConfig = await loadHandler({
    setupIntent: {
      id: 'seti_wrong_amount_price',
      status: 'succeeded',
      metadata: { leadId: 'lead_wrong_amount_price', product: 'listing_membership' },
      customer: 'cus_wrong_amount_price',
      payment_method: 'pm_wrong_amount_price',
    },
    price: { id: 'price_wrong_amount', active: true, livemode: true, currency: 'usd', unit_amount: 999, recurring: { interval: 'month' } },
    subscription: { id: 'sub_should_not_create', status: 'trialing' },
    entitlements: { paid10: false },
    patchEntitlements: async (_leadId, patch) => patch,
  });
  const wrongAmountPriceRes = await wrongAmountPriceConfig.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_wrong_amount_price', setupIntentId: 'seti_wrong_amount_price', product: 'prescreen' }),
  });
  assert.equal(wrongAmountPriceRes.statusCode, 500);
  assert.match(JSON.parse(wrongAmountPriceRes.body).error, /\$19\.99\/month/i);
  assert.equal(wrongAmountPriceConfig.subscriptionCreateCalls.length, 0);

  const mismatchHandler = await loadHandler({
    paymentIntent: { ...succeededIntent, metadata: { leadId: 'other_lead' } },
    patchEntitlements: async () => ({}),
  });
  const mismatchRes = await mismatchHandler.handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      leadId: 'lead_123',
      paymentIntentId: 'pi_test',
      product: 'prescreen',
    }),
  });
  assert.equal(mismatchRes.statusCode, 403);

  // Regression: the welcome email must go out the first time a lead's $10
  // pre-screen succeeds...
  const firstTime = await loadHandler({
    paymentIntent: succeededIntent,
    entitlements: { paid10: false },
    patchEntitlements: async () => ({ paid10: true }),
  });
  await firstTime.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', paymentIntentId: 'pi_test', product: 'prescreen' }),
  });
  assert.deepEqual(firstTime.welcomeEmailCalls, ['lead_123']);

  // ...but never again on a later confirm-intent call for a lead who
  // already has paid10 (e.g. a page refresh re-confirming the same intent).
  const repeat = await loadHandler({
    paymentIntent: succeededIntent,
    entitlements: { paid10: true },
    patchEntitlements: async () => ({ paid10: true }),
  });
  await repeat.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', paymentIntentId: 'pi_test', product: 'prescreen' }),
  });
  assert.deepEqual(repeat.welcomeEmailCalls, []);

  // ...and never for a non-prescreen product succeeding.
  const upsell = await loadHandler({
    paymentIntent: { ...succeededIntent, metadata: { leadId: 'lead_123' } },
    entitlements: { paid10: true },
    patchEntitlements: async () => ({ paid27: true }),
  });
  await upsell.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', paymentIntentId: 'pi_test', product: 'gameplan' }),
  });
  assert.deepEqual(upsell.welcomeEmailCalls, []);
  assert.deepEqual(upsell.downloadEmailCalls, []);

  // A Modern/Luxury payment confirmed after required bank authentication
  // must still send the guide download email from the server-side success path.
  const apartmentUpsell = await loadHandler({
    paymentIntent: { ...succeededIntent, metadata: { leadId: 'lead_123' } },
    entitlements: { paid10: true, purchasedCategories: [] },
    patchEntitlements: async () => ({ paid27: true, purchasedCategories: ['luxury'] }),
  });
  await apartmentUpsell.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', paymentIntentId: 'pi_test', product: 'luxury' }),
  });
  assert.deepEqual(apartmentUpsell.welcomeEmailCalls, []);
  assert.deepEqual(apartmentUpsell.downloadEmailCalls, [{ leadId: 'lead_123', product: 'luxury' }]);

  // The Apartment Prep Kit uses the same server-confirmed success path
  // after required bank authentication, and it must send the kit email too.
  const prepPatchCalls = [];
  const prepUpsell = await loadHandler({
    paymentIntent: { ...succeededIntent, metadata: { leadId: 'lead_123' } },
    entitlements: { paid10: true, purchasedCategories: [] },
    patchEntitlements: async (leadId, patch) => {
      prepPatchCalls.push({ leadId, patch });
      return { ...patch, purchasedCategories: ['apartment_prep'] };
    },
  });
  await prepUpsell.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', paymentIntentId: 'pi_test', product: 'apartment_prep' }),
  });
  assert.deepEqual(prepPatchCalls, [{
    leadId: 'lead_123',
    patch: {
      paid47: true,
      paid27: true,
      stripeCustomerId: 'cus_test',
      defaultPaymentMethodId: 'pm_test',
      addPurchasedCategory: 'apartment_prep',
    },
  }]);
  assert.deepEqual(prepUpsell.welcomeEmailCalls, []);
  assert.deepEqual(prepUpsell.downloadEmailCalls, [{ leadId: 'lead_123', product: 'apartment_prep' }]);

  // A welcome-email failure must not fail the payment confirmation itself.
  const emailFails = await loadHandler({
    paymentIntent: succeededIntent,
    entitlements: { paid10: false },
    patchEntitlements: async () => ({ paid10: true }),
    sendWelcomeEmail: async () => {
      throw new Error('GAS unreachable');
    },
  });
  const emailFailsRes = await emailFails.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', paymentIntentId: 'pi_test', product: 'prescreen' }),
  });
  assert.equal(emailFailsRes.statusCode, 200);
  assert.equal(JSON.parse(emailFailsRes.body).ok, true);
}


async function runSecurityAndScreeningChecks() {
  process.env.STRIPE_LISTING_PRICE_MONTHLY = 'price_1999_monthly';
  const setupIntent = {
    id: 'seti_screen',
    status: 'succeeded',
    metadata: { leadId: 'lead_screen', product: 'listing_membership' },
    customer: 'cus_screen',
    payment_method: 'pm_screen',
  };
  const subscription = { id: 'sub_screen', status: 'trialing', current_period_start: 1800000000, current_period_end: 1800604800 };
  const body = JSON.stringify({ leadId: 'lead_screen', setupIntentId: 'seti_screen', product: 'prescreen' });

  // No session cookie -> refused before touching Stripe.
  const noSession = await loadHandler({ setupIntent, subscription, patchEntitlements: async (_l, p) => p, session: null });
  const noSessionRes = await noSession.handler({ httpMethod: 'POST', body });
  assert.equal(noSessionRes.statusCode, 401);
  assert.equal(noSession.subscriptionCreateCalls.length, 0);

  // Session for another lead -> refused.
  const otherLead = await loadHandler({ setupIntent, subscription, patchEntitlements: async (_l, p) => p, session: { leadId: 'someone_else', scope: 'paid' } });
  assert.equal((await otherLead.handler({ httpMethod: 'POST', body })).statusCode, 403);

  // Completing a 3DS upsell needs the paid session, not just the lead one.
  const upsellLeadScope = await loadHandler({
    paymentIntent: { id: 'pi_up', status: 'succeeded', metadata: { leadId: 'lead_screen', product: 'modern' } },
    patchEntitlements: async (_l, p) => p,
    session: { leadId: 'lead_screen', scope: 'lead' },
  });
  assert.equal((await upsellLeadScope.handler({ httpMethod: 'POST', body: JSON.stringify({ leadId: 'lead_screen', paymentIntentId: 'pi_up', product: 'modern' }) })).statusCode, 403);

  // Prepaid card -> rejected, card detached, no trial, no $1 hold.
  const prepaidPatches = [];
  const prepaid = await loadHandler({ setupIntent, subscription, cardFunding: 'prepaid', patchEntitlements: async (_l, p) => { prepaidPatches.push(p); return p; } });
  const prepaidRes = await prepaid.handler({ httpMethod: 'POST', body });
  const prepaidBody = JSON.parse(prepaidRes.body);
  assert.equal(prepaidBody.status, 'card_rejected');
  assert.equal(prepaidBody.reason, 'prepaid_card');
  assert.equal(prepaidBody.useDifferentCard, true);
  assert.match(prepaidBody.message, /Prepaid/);
  assert.equal(prepaid.subscriptionCreateCalls.length, 0);
  assert.equal(prepaid.cardCheckCalls.length, 0);
  assert.deepEqual(prepaid.detachCalls, ['pm_screen']);
  assert.equal(prepaidPatches[0].rejectedSetupIntentId, 'seti_screen');
  assert.equal(prepaidPatches[0].listingSetupIntentId, null);

  // $1 check declined for insufficient funds -> rejected with the right message.
  const nsf = new Error('Your card has insufficient funds.');
  nsf.type = 'StripeCardError';
  nsf.code = 'card_declined';
  nsf.decline_code = 'insufficient_funds';
  nsf.raw = { type: 'card_error', payment_intent: { id: 'pi_check_failed' } };
  const lowFunds = await loadHandler({ setupIntent, subscription, cardCheck: { error: nsf }, patchEntitlements: async (_l, p) => p });
  const lowFundsBody = JSON.parse((await lowFunds.handler({ httpMethod: 'POST', body })).body);
  assert.equal(lowFundsBody.status, 'card_rejected');
  assert.equal(lowFundsBody.reason, 'insufficient_funds');
  assert.match(lowFundsBody.message, /different card/);
  assert.equal(lowFunds.subscriptionCreateCalls.length, 0);
  assert.deepEqual(lowFunds.detachCalls, ['pm_screen']);

  // Retrying the same rejected card setup returns the rejection without new holds.
  const retryRejected = await loadHandler({
    setupIntent,
    subscription,
    entitlements: { paid10: false, rejectedSetupIntentId: 'seti_screen', cardRejectReason: 'insufficient_funds', cardRejectMessage: 'This card doesn’t have enough available funds. Please try a different card.' },
    patchEntitlements: async (_l, p) => p,
  });
  const retryRejectedBody = JSON.parse((await retryRejected.handler({ httpMethod: 'POST', body })).body);
  assert.equal(retryRejectedBody.status, 'card_rejected');
  assert.equal(retryRejected.cardCheckCalls.length, 0);
  assert.equal(retryRejected.subscriptionCreateCalls.length, 0);

  // Bank asks for 3DS on the $1 check -> hold released, trial still starts.
  const needs3ds = await loadHandler({ setupIntent, subscription, cardCheck: { intent: { id: 'pi_check_3ds', status: 'requires_action' } }, patchEntitlements: async (_l, p) => p });
  const needs3dsBody = JSON.parse((await needs3ds.handler({ httpMethod: 'POST', body })).body);
  assert.equal(needs3dsBody.status, 'succeeded');
  assert.deepEqual(needs3ds.cancelCalls, ['pi_check_3ds']);

  // Stripe outage during the check -> fail open, trial still starts.
  const outage = new Error('Stripe API unavailable');
  outage.type = 'StripeAPIError';
  const stripeDown = await loadHandler({ setupIntent, subscription, cardCheck: { error: outage }, patchEntitlements: async (_l, p) => p });
  assert.equal(JSON.parse((await stripeDown.handler({ httpMethod: 'POST', body })).body).status, 'succeeded');

  // The checkout page retries confirmation up to 3x: never a second trial.
  const alreadyDone = await loadHandler({
    setupIntent,
    subscription,
    entitlements: { paid10: true, listingSetupIntentConfirmedId: 'seti_screen', listingSubscriptionId: 'sub_screen', listingSubscriptionStatus: 'trialing' },
    patchEntitlements: async (_l, p) => p,
  });
  const alreadyDoneRes = await alreadyDone.handler({ httpMethod: 'POST', body });
  const alreadyDoneBody = JSON.parse(alreadyDoneRes.body);
  assert.equal(alreadyDoneBody.status, 'succeeded');
  assert.equal(alreadyDoneBody.subscriptionId, 'sub_screen');
  assert.equal(alreadyDone.subscriptionCreateCalls.length, 0);
  assert.equal(alreadyDone.cardCheckCalls.length, 0);
  assert.equal(sessionFromSetCookie(alreadyDoneRes).scope, 'paid');

  // Check amount is configurable; 0 turns the hold off.
  process.env.TRIAL_CARD_CHECK_AMOUNT_CENTS = '0';
  const noHold = await loadHandler({ setupIntent, subscription, patchEntitlements: async (_l, p) => p });
  assert.equal(JSON.parse((await noHold.handler({ httpMethod: 'POST', body })).body).status, 'succeeded');
  assert.equal(noHold.cardCheckCalls.length, 0);
  delete process.env.TRIAL_CARD_CHECK_AMOUNT_CENTS;
}

run()
  .then(runSecurityAndScreeningChecks)
  .then(() => console.log('confirm-intent flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
