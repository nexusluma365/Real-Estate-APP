const assert = require('assert');

function loadHandler({ constructEvent, patchEntitlements, entitlements, sendWelcomeEmail, sendDownloadEmail }) {
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const welcomeEmailPath = require.resolve('../netlify/functions/_lib/welcome-email');
  const downloadEmailPath = require.resolve('../netlify/functions/_lib/download-email');
  const fnPath = require.resolve('../netlify/functions/stripe-webhook');
  delete require.cache[fnPath];

  const welcomeEmailCalls = [];
  const downloadEmailCalls = [];

  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      getStripe: () => ({
        webhooks: { constructEvent },
        customers: { update: async () => ({}) },
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
        }),
    },
  };

  return { handler: require('../netlify/functions/stripe-webhook').handler, welcomeEmailCalls, downloadEmailCalls };
}

async function run() {
  // A base64-encoded event body (as Netlify delivers for some content types)
  // must be decoded back to raw bytes before signature verification, or
  // every real webhook call would fail with a signature mismatch.
  const patchCalls = [];
  const rawJson = JSON.stringify({
    type: 'payment_intent.succeeded',
    data: { object: { metadata: { leadId: 'lead_123', product: 'modern' }, customer: 'cus_1', payment_method: 'pm_1' } },
  });
  const seenPayloads = [];
  const modernBackstop = loadHandler({
    constructEvent: (payload, sig, secret) => {
      seenPayloads.push(payload);
      assert.equal(sig, 'test_sig');
      assert.equal(secret, process.env.STRIPE_WEBHOOK_SECRET);
      return JSON.parse(payload.toString());
    },
    patchEntitlements: async (leadId, patch) => {
      patchCalls.push({ leadId, patch });
    },
    entitlements: { paid10: true, purchasedCategories: [] },
  });

  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const res = await modernBackstop.handler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': 'test_sig' },
    isBase64Encoded: true,
    body: Buffer.from(rawJson, 'utf8').toString('base64'),
  });

  assert.equal(res.statusCode, 200);
  assert.ok(Buffer.isBuffer(seenPayloads[0]));
  assert.equal(seenPayloads[0].toString('utf8'), rawJson);
  assert.equal(patchCalls.length, 1);
  assert.deepEqual(patchCalls[0], {
    leadId: 'lead_123',
    patch: { paid27: true, stripeCustomerId: 'cus_1', defaultPaymentMethodId: 'pm_1', addPurchasedCategory: 'modern' },
  });
  assert.deepEqual(modernBackstop.downloadEmailCalls, [{ leadId: 'lead_123', product: 'modern' }]);

  // A plain (non-base64) body must still be passed through unchanged.
  const plainCalls = [];
  const { handler: plainHandler } = loadHandler({
    constructEvent: (payload) => {
      plainCalls.push(payload);
      return { type: 'unhandled.event.type', data: { object: {} } };
    },
    patchEntitlements: async () => {},
  });
  const plainRes = await plainHandler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': 'test_sig' },
    body: rawJson,
  });
  assert.equal(plainRes.statusCode, 200);
  assert.equal(plainCalls[0], rawJson);

  // A bad signature must be rejected with a 400, not silently accepted.
  const { handler: rejectingHandler } = loadHandler({
    constructEvent: () => {
      throw new Error('signature mismatch');
    },
    patchEntitlements: async () => {},
  });
  const rejectedRes = await rejectingHandler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': 'bad_sig' },
    body: rawJson,
  });
  assert.equal(rejectedRes.statusCode, 400);

  // Regression: this webhook is the welcome-email backstop for a lead whose
  // first $10 pre-screen payment it is the first thing to see succeed (e.g.
  // the customer closed the tab before confirm-intent.js's own call landed).
  const prescreenJson = JSON.stringify({
    type: 'payment_intent.succeeded',
    data: { object: { metadata: { leadId: 'lead_456', product: 'prescreen' }, customer: 'cus_2', payment_method: 'pm_2' } },
  });
  const firstTime = loadHandler({
    constructEvent: (payload) => JSON.parse(payload.toString()),
    patchEntitlements: async () => ({}),
    entitlements: { paid10: false },
  });
  await firstTime.handler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': 'test_sig' },
    body: prescreenJson,
  });
  assert.deepEqual(firstTime.welcomeEmailCalls, ['lead_456']);

  // But not if confirm-intent.js (or an earlier webhook delivery) already
  // set paid10 for this lead — no double-send.
  const alreadyPaid = loadHandler({
    constructEvent: (payload) => JSON.parse(payload.toString()),
    patchEntitlements: async () => ({}),
    entitlements: { paid10: true },
  });
  await alreadyPaid.handler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': 'test_sig' },
    body: prescreenJson,
  });
  assert.deepEqual(alreadyPaid.welcomeEmailCalls, []);

  // The Apartment Prep Kit download email is also covered by the webhook
  // backstop if the browser never returns to confirm-intent after Stripe wins.
  const prepJson = JSON.stringify({
    type: 'payment_intent.succeeded',
    data: { object: { metadata: { leadId: 'lead_789', product: 'apartment_prep' }, customer: 'cus_3', payment_method: 'pm_3' } },
  });
  const prepBackstop = loadHandler({
    constructEvent: (payload) => JSON.parse(payload.toString()),
    patchEntitlements: async () => ({}),
    entitlements: { paid10: true, purchasedCategories: [] },
  });
  await prepBackstop.handler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': 'test_sig' },
    body: prepJson,
  });
  assert.deepEqual(prepBackstop.downloadEmailCalls, [{ leadId: 'lead_789', product: 'apartment_prep' }]);

  // If the synchronous checkout path already recorded the purchase, the
  // webhook must not send a duplicate download email.
  const prepAlreadyHandled = loadHandler({
    constructEvent: (payload) => JSON.parse(payload.toString()),
    patchEntitlements: async () => ({}),
    entitlements: { paid10: true, paid27: true, purchasedCategories: ['apartment_prep'] },
  });
  await prepAlreadyHandled.handler({
    httpMethod: 'POST',
    headers: { 'stripe-signature': 'test_sig' },
    body: prepJson,
  });
  assert.deepEqual(prepAlreadyHandled.downloadEmailCalls, []);
}

run()
  .then(() => console.log('stripe-webhook flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
