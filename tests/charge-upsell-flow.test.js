const assert = require('assert');

async function loadHandler({ entitlements, prescreenIntent, upsellIntent, upsellError, patchEntitlements, sendDownloadEmail }) {
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const focusPath = require.resolve('../netlify/functions/_lib/focus');
  const downloadEmailPath = require.resolve('../netlify/functions/_lib/download-email');
  const funnelPath = require.resolve('../netlify/functions/_lib/funnel');
  const fnPath = require.resolve('../netlify/functions/charge-upsell');
  delete require.cache[fnPath];

  const retrieveCalls = [];
  const createCalls = [];
  const createOptions = [];
  const downloadEmailCalls = [];
  const funnelEvents = [];

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
          create: async (payload, options) => {
            createCalls.push(payload);
            createOptions.push(options);
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
      getLead: async () => ({ credit_score: '700_739', email: 'buyer@example.com' }),
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
  require.cache[funnelPath] = {
    id: funnelPath,
    filename: funnelPath,
    loaded: true,
    exports: {
      logFunnelEvent: async (event, fields) => {
        funnelEvents.push({ event, fields });
        return true;
      },
    },
  };

  const handler = require('../netlify/functions/charge-upsell').handler;
  return { handler, retrieveCalls, createCalls, createOptions, downloadEmailCalls, funnelEvents };
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
      manychat_contact_id: '123456789',
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
  assert.equal(createCalls[0].off_session, true);
  assert.deepEqual(createCalls[0].payment_method_types, ['card']);
  assert.deepEqual(createCalls[0].payment_method_options, { card: { request_three_d_secure: 'automatic' } });
  assert.equal(createCalls[0].description, 'RentReady Modern Apartment Matches & RentReady Guide');
  assert.equal(createCalls[0].receipt_email, 'buyer@example.com');
  assert.equal(createCalls[0].metadata.manychat_contact_id, '123456789');
  assert.equal(patchCalls.length, 2);
  assert.deepEqual(patchCalls[0].patch, {
    paid10: true,
    stripeCustomerId: 'cus_test',
    defaultPaymentMethodId: 'pm_test',
  });
  assert.deepEqual(patchCalls[1].patch, {
    paid27: true,
    addPurchasedCategory: 'modern',
    manychat_contact_id: '123456789',
    manychatContactId: '123456789',
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

  // The Apartment Approval Preparation Kit uses the one-click upsell
  // infrastructure at $20 and sends the RentReady Kit download email.
  const prepPatchCalls = [];
  const apartmentPrep = await loadHandler({
    entitlements: {
      leadId: 'lead_123',
      paid10: true,
      paid27: false,
      paid97: false,
      purchasedCategories: [],
      stripeCustomerId: 'cus_test',
      defaultPaymentMethodId: 'pm_test',
    },
    upsellIntent: { id: 'pi_prep', status: 'succeeded' },
    patchEntitlements: async (leadId, patch) => {
      prepPatchCalls.push({ leadId, patch });
      return { leadId, purchasedCategories: ['apartment_prep'], ...patch };
    },
  });
  const prepRes = await apartmentPrep.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', product: 'apartment_prep', idempotencyKey: 'idem_prep', amount: 1 }),
  });
  const prepBody = JSON.parse(prepRes.body);
  assert.equal(prepRes.statusCode, 200);
  assert.equal(prepBody.status, 'succeeded');
  assert.equal(apartmentPrep.createCalls.length, 1);
  assert.equal(apartmentPrep.createCalls[0].amount, 2000);
  assert.equal(apartmentPrep.createCalls[0].currency, 'usd');
  assert.equal(apartmentPrep.createCalls[0].off_session, undefined, 'apartment_prep should use customer-present PaymentIntent confirmation');
  assert.equal(apartmentPrep.createCalls[0].metadata.product, 'apartment_prep');
  assert.equal(apartmentPrep.createOptions[0].idempotencyKey, 'lead_123:apartment_prep:idem_prep');
  assert.deepEqual(prepPatchCalls[0].patch, { paid47: true, paid27: true, addPurchasedCategory: 'apartment_prep' });
  assert.deepEqual(apartmentPrep.downloadEmailCalls, [{ leadId: 'lead_123', product: 'apartment_prep' }]);
  assert.deepEqual(apartmentPrep.funnelEvents[0], {
    event: 'upsell_paid',
    fields: { lead_id: 'lead_123', payment_id: 'pi_prep', amount: 20, detail: { product: 'apartment_prep' } },
  });

  // Already owning apartment_prep is a no-op success, not a second $20 charge.
  const alreadyOwnsPrep = await loadHandler({
    entitlements: {
      leadId: 'lead_123',
      paid10: true,
      paid27: true,
      paid47: true,
      paid97: false,
      purchasedCategories: ['apartment_prep'],
      stripeCustomerId: 'cus_test',
      defaultPaymentMethodId: 'pm_test',
    },
    patchEntitlements: async () => ({}),
  });
  const alreadyOwnsPrepRes = await alreadyOwnsPrep.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', product: 'apartment_prep', idempotencyKey: 'idem_prep_repeat' }),
  });
  const alreadyOwnsPrepBody = JSON.parse(alreadyOwnsPrepRes.body);
  assert.equal(alreadyOwnsPrepRes.statusCode, 200);
  assert.equal(alreadyOwnsPrepBody.status, 'succeeded');
  assert.equal(alreadyOwnsPrepBody.alreadyOwned, true);
  assert.equal(alreadyOwnsPrep.createCalls.length, 0);

  // If Stripe requires customer authentication, the server returns the
  // PaymentIntent details for Stripe.js and grants no entitlement yet.
  const actionRequired = await loadHandler({
    entitlements: {
      leadId: 'lead_123',
      paid10: true,
      paid27: false,
      paid97: false,
      purchasedCategories: [],
      stripeCustomerId: 'cus_test',
      defaultPaymentMethodId: 'pm_test',
    },
    upsellIntent: { id: 'pi_requires_action', status: 'requires_action', client_secret: 'pi_requires_action_secret' },
    patchEntitlements: async () => {
      throw new Error('should not grant before authentication succeeds');
    },
  });
  const actionRequiredRes = await actionRequired.handler({
    httpMethod: 'POST',
    body: JSON.stringify({ leadId: 'lead_123', product: 'apartment_prep', idempotencyKey: 'idem_action' }),
  });
  const actionRequiredBody = JSON.parse(actionRequiredRes.body);
  assert.equal(actionRequiredRes.statusCode, 200);
  assert.equal(actionRequiredBody.status, 'requires_action');
  assert.equal(actionRequiredBody.clientSecret, 'pi_requires_action_secret');
  assert.equal(actionRequiredBody.paymentIntentId, 'pi_requires_action');

  // A declined upsell must not send the download email.
  const declineError = new Error('card declined');
  declineError.code = 'card_declined';
  declineError.decline_code = 'insufficient_funds';
  declineError.raw = { payment_intent: { id: 'pi_declined' } };
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
    body: JSON.stringify({ leadId: 'lead_123', product: 'apartment_prep', idempotencyKey: 'idem_decline' }),
  });
  const declinedBody = JSON.parse(declinedRes.body);
  assert.equal(declinedRes.statusCode, 200);
  assert.equal(declinedBody.status, 'failed');
  assert.match(declinedBody.message, /\$20 purchase/);
  assert.deepEqual(declined.downloadEmailCalls, []);
  assert.deepEqual(declined.funnelEvents[0], {
    event: 'upsell_failed',
    fields: { lead_id: 'lead_123', detail: { product: 'apartment_prep', reason: 'insufficient_funds', amount: 2000 } },
  });
}

run()
  .then(() => console.log('charge-upsell flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
