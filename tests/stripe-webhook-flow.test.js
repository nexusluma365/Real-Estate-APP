const assert = require('assert');

function loadHandler({ constructEvent, patchEntitlements }) {
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const fnPath = require.resolve('../netlify/functions/stripe-webhook');
  delete require.cache[fnPath];

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
    exports: { patchEntitlements },
  };

  return require('../netlify/functions/stripe-webhook').handler;
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
  const handler = loadHandler({
    constructEvent: (payload, sig, secret) => {
      seenPayloads.push(payload);
      assert.equal(sig, 'test_sig');
      assert.equal(secret, process.env.STRIPE_WEBHOOK_SECRET);
      return JSON.parse(payload.toString());
    },
    patchEntitlements: async (leadId, patch) => {
      patchCalls.push({ leadId, patch });
    },
  });

  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  const res = await handler({
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

  // A plain (non-base64) body must still be passed through unchanged.
  const plainCalls = [];
  const plainHandler = loadHandler({
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
  const rejectingHandler = loadHandler({
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
}

run()
  .then(() => console.log('stripe-webhook flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
