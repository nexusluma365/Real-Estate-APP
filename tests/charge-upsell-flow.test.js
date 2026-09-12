const assert = require('assert');

async function loadHandler({ entitlements, prescreenIntent, upsellIntent, upsellError, patchEntitlements, sendDownloadEmail }) {
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const focusPath = require.resolve('../netlify/functions/_lib/focus');
  const downloadEmailPath = require.resolve('../netlify/functions/_lib/download-email');
  const fnPath = require.resolve('../netlify/functions/charge-upsell');
  delete require.cache[fnPath];

  const retrieveCalls = [];
  const createCalls = [];
  const downloadEmailCalls = [];

  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      getStripe: () => ({
        paymentIntents: {
          retrieve: async (id) => {
            retrieveCalls.push(id);
            return prescreenIntent;
          },
          create: async (payload) => {
            createCalls.push(payload);
            if (upsellError) throw upsellError;
            return upsellIntent;
          },
        },
      }),
    },
  };

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getEntitlements: async () => entitlements,
      getLead: async () => ({ credit_score: '700_739' }),
      patchEntitlements,
    },
  };

  require.cache[focusPath] = {
    id: focusPath,
    filename: focusPath,
    loaded: true,
    exports: { determineFocus: () => 'income' },
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

  const handler = require('../netlify/functions/charge-upsell').handler;
  return { handler, retrieveCalls, createCalls, downloadEmailCalls };
}

async function run() {
  const patchCalls = [];
  const { handler, retrieveCalls, createCalls, downloadEmailCalls } = await loadHandler({
    entitlements: {
      leadId: 'lead_123',
      paid10: false,
      paid27: false,
      paid97: false,
      stripeCustomerId: null,
      defaultPaymentMethodId: null,
    },
    prescreenIntent: {
      id: 'pi_prescreen',
      status: 'succeeded',
      metadata: { leadId: 'lead_123', product: 'prescreen' },
      customer: 'cus_test',
      payment_method: 'pm_test',
    },
    upsellIntent: { id: 'pi_upsell', status: 'succeeded' },
    patchEntitlements: async (leadId, patch) => {
      patchCalls.push({ leadId, patch });
      return { leadId, paid10: true, ...patch };
    },
  });

  const res = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      leadId: 'lead_123',
      product: 'modern',
      idempotencyKey: 'idem_123',
      prescreenPaymentIntentId: 'pi_prescreen',
    }),
  });
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(body.status, 'succeeded');
  assert.equal(body.paymentIntentId, 'pi_upsell');
  assert.deepEqual(retrieveCalls, ['pi_prescreen']);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].amount, 2700);
  assert.equal(createCalls[0].customer, 'cus_test');
  assert.equal(createCalls[0].payment_method, 'pm_test');
  assert.equal(patchCalls.length, 2);
  assert.deepEqual(patchCalls[0].patch, {
    paid10: true,
    stripeCustomerId: 'cus_test',
    defaultPaymentMethodId: 'pm_test',
  });
  assert.deepEqual(patchCalls[1].patch, {
    paid27: true,
    addPurchasedCategory: 'modern',
  });
  assert.deepEqual(downloadEmailCalls, [{ leadId: 'lead_123', product: 'modern' }]);

  const mismatch = await loadHandler({
    entitlements: {
      leadId: 'lead_123',
      paid10: false,
      paid27: false,
      paid97: false,
      stripeCustomerId: null,
      defaultPaymentMethodId: null,
    },
    prescreenIntent: {
      id: 'pi_other',
      status: 'succeeded',
      metadata: { leadId: 'other_lead', product: 'prescreen' },
      customer: 'cus_test',
      payment_method: 'pm_test',
    },
    upsellIntent: { id: 'pi_upsell', status: 'succeeded' },
    patchEntitlements: async () => ({}),
  });
  const mismatchRes = await mismatch.handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      leadId: 'lead_123',
      product: 'modern',
      idempotencyKey: 'idem_123',
      prescreenPaymentIntentId: 'pi_other',
    }),
  });
  assert.equal(mismatchRes.statusCode, 403);
  assert.equal(mismatch.createCalls.length, 0);

  // Regression: owning one apartment category must not block buying (or
  // charge twice for) the other one, and must not be treated as already
  // owning it.
  const secondCategoryPatchCalls = [];
  const secondCategory = await loadHandler({
    entitlements: {
      leadId: 'lead_123',
      paid10: true,
      paid27: true,
      paid97: false,
      purchasedCategories: ['modern'],
      stripeCustomerId: 'cus_test',
      defaultPaymentMethodId: 'pm_test',
    },
    upsellIntent: { id: 'pi_luxury', status: 'succeeded' },
    patchEntitlements: async (leadId, patch) => {
      secondCategoryPatchCalls.push({ leadId, patch });
      return { leadId, purchasedCategories: ['modern', 'luxury'], ...patch };
    },
  });
  const secondCategoryRes = await secondCategory.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', product: 'luxury', idempotencyKey: 'idem_456' }),
  });
  const secondCategoryBody = JSON.parse(secondCategoryRes.body);
  assert.equal(secondCategoryRes.statusCode, 200);
  assert.equal(secondCategoryBody.status, 'succeeded');
  assert.equal(secondCategoryBody.alreadyOwned, undefined);
  assert.equal(secondCategory.createCalls.length, 1);
  assert.deepEqual(secondCategoryPatchCalls[0].patch, { paid27: true, addPurchasedCategory: 'luxury' });
  assert.deepEqual(secondCategory.downloadEmailCalls, [{ leadId: 'lead_123', product: 'luxury' }]);

  // Already owning a category is a no-op success, not a second charge.
  const alreadyOwned = await loadHandler({
    entitlements: {
      leadId: 'lead_123',
      paid10: true,
      paid27: true,
      paid97: false,
      purchasedCategories: ['modern', 'luxury'],
      stripeCustomerId: 'cus_test',
      defaultPaymentMethodId: 'pm_test',
    },
    patchEntitlements: async () => ({}),
  });
  const alreadyOwnedRes = await alreadyOwned.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', product: 'modern', idempotencyKey: 'idem_789' }),
  });
  const alreadyOwnedBody = JSON.parse(alreadyOwnedRes.body);
  assert.equal(alreadyOwnedRes.statusCode, 200);
  assert.equal(alreadyOwnedBody.alreadyOwned, true);
  assert.equal(alreadyOwned.createCalls.length, 0);
  assert.deepEqual(alreadyOwned.downloadEmailCalls, [{ leadId: 'lead_123', product: 'modern' }]);

  // A declined upsell must not send the download email.
  const declineError = new Error('card declined');
  declineError.code = 'card_declined';
  const declined = await loadHandler({
    entitlements: {
      leadId: 'lead_123',
      paid10: true,
      paid27: false,
      paid97: false,
      purchasedCategories: [],
      stripeCustomerId: 'cus_test',
      defaultPaymentMethodId: 'pm_test',
    },
    upsellError: declineError,
    patchEntitlements: async () => ({}),
  });
  const declinedRes = await declined.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', product: 'modern', idempotencyKey: 'idem_decline' }),
  });
  assert.equal(declinedRes.statusCode, 200);
  assert.equal(JSON.parse(declinedRes.body).status, 'failed');
  assert.deepEqual(declined.downloadEmailCalls, []);
}

run()
  .then(() => console.log('charge-upsell flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
