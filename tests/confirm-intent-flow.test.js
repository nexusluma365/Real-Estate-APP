const assert = require('assert');

async function loadHandler({ paymentIntent, setupIntent, subscription, patchEntitlements, customerUpdate, entitlements, sendWelcomeEmail, sendDownloadEmail }) {
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const welcomeEmailPath = require.resolve('../netlify/functions/_lib/welcome-email');
  const downloadEmailPath = require.resolve('../netlify/functions/_lib/download-email');
  const fnPath = require.resolve('../netlify/functions/confirm-intent');
  delete require.cache[fnPath];

  const welcomeEmailCalls = [];
  const downloadEmailCalls = [];
  const subscriptionCreateCalls = [];

  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      getStripe: () => ({
        paymentIntents: {
          retrieve: async () => paymentIntent,
        },
        setupIntents: {
          retrieve: async () => setupIntent,
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

  return { handler: require('../netlify/functions/confirm-intent').handler, welcomeEmailCalls, downloadEmailCalls, subscriptionCreateCalls };
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
  assert.equal(setupTrial.subscriptionCreateCalls[0].options.idempotencyKey, 'lead_setup:listing-subscription:trial-1999-v4');

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

run()
  .then(() => console.log('confirm-intent flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
