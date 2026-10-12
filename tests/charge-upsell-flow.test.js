const assert = require('assert');
const { withSession } = require('./_session-helper');

async function loadHandler({ entitlements, prescreenIntent, pendingIntent, upsellIntent, upsellError, patchEntitlements, sendDownloadEmail, session = { leadId: 'lead_123', scope: 'paid' } }) {
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
            if (pendingIntent && id === pendingIntent.id) return pendingIntent;
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

  const rawHandler = require('../netlify/functions/charge-upsell').handler;
  const handler = (event) => rawHandler(session ? withSession(event, session.leadId, session.scope) : event);
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
  assert.equal(createCalls[0].amount, 2000);
  assert.equal(createCalls[0].customer, 'cus_test');
  assert.equal(createCalls[0].payment_method, 'pm_test');
  assert.equal(createCalls[0].off_session, undefined, 'customer-clicked upsells are charged on-session');
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
  assert.match(apartmentPrep.createOptions[0].idempotencyKey, /^lead_123:apartment_prep:w\d+:a0$/, 'idempotency key is derived on the server, not taken from the browser');
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
    patchEntitlements: async (_leadId, patch) => {
      if (patch.paid47 || patch.paid27 || patch.addPurchasedCategory) {
        throw new Error('should not grant before authentication succeeds');
      }
      return {};
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
  assert.match(declinedBody.message, /insufficient funds/);
  assert.match(declinedBody.message, /different card/);
  assert.equal(declinedBody.reason, 'insufficient_funds');
  assert.equal(declinedBody.useDifferentCard, true);
  assert.deepEqual(declined.downloadEmailCalls, []);
  assert.deepEqual(declined.funnelEvents[0], {
    event: 'upsell_failed',
    fields: { lead_id: 'lead_123', detail: { product: 'apartment_prep', reason: 'insufficient_funds', amount: 2000 } },
  });
}

async function runSecurityChecks() {
  const paidEntitlements = (extra = {}) => ({
    leadId: 'lead_123',
    paid10: true,
    paid27: false,
    paid97: false,
    purchasedCategories: [],
    stripeCustomerId: 'cus_test',
    defaultPaymentMethodId: 'pm_test',
    ...extra,
  });

  // 1. A bare leadId is not enough: no session cookie, no charge.
  const noSession = await loadHandler({ entitlements: paidEntitlements(), upsellIntent: { id: 'pi_x', status: 'succeeded' }, patchEntitlements: async () => ({}), session: null });
  const noSessionRes = await noSession.handler({ httpMethod: 'POST', body: JSON.stringify({ leadId: 'lead_123', product: 'modern' }) });
  assert.equal(noSessionRes.statusCode, 401);
  assert.equal(JSON.parse(noSessionRes.body).code, 'session_required');
  assert.equal(noSession.createCalls.length, 0);

  // 2. A session for a different lead can't charge this lead's card.
  const otherLead = await loadHandler({ entitlements: paidEntitlements(), upsellIntent: { id: 'pi_x', status: 'succeeded' }, patchEntitlements: async () => ({}), session: { leadId: 'attacker_lead', scope: 'paid' } });
  const otherLeadRes = await otherLead.handler({ httpMethod: 'POST', body: JSON.stringify({ leadId: 'lead_123', product: 'modern' }) });
  assert.equal(otherLeadRes.statusCode, 403);
  assert.equal(otherLead.createCalls.length, 0);

  // 3. A 'lead' (pre-payment) session can't use one-click charges.
  const leadScope = await loadHandler({ entitlements: paidEntitlements(), upsellIntent: { id: 'pi_x', status: 'succeeded' }, patchEntitlements: async () => ({}), session: { leadId: 'lead_123', scope: 'lead' } });
  const leadScopeRes = await leadScope.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) });
  assert.equal(leadScopeRes.statusCode, 403);
  assert.equal(leadScope.createCalls.length, 0);

  // 4. Lead comes from the session even when the body omits it.
  const fromSession = await loadHandler({ entitlements: paidEntitlements(), upsellIntent: { id: 'pi_ok', status: 'succeeded' }, patchEntitlements: async (l, p) => ({ leadId: l, ...p }) });
  const fromSessionRes = await fromSession.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) });
  assert.equal(JSON.parse(fromSessionRes.body).status, 'succeeded');
  assert.equal(fromSession.createCalls[0].metadata.leadId, 'lead_123');

  // 5. Double click / two tabs: identical state -> identical idempotency key,
  //    so Stripe executes the charge once.
  const now = Date.now();
  const stable = paidEntitlements({ paymentAttempts: { modern: { windowStart: now, failures: 0, paymentMethodId: 'pm_test' } } });
  const tabA = await loadHandler({ entitlements: stable, upsellIntent: { id: 'pi_same', status: 'processing' }, patchEntitlements: async () => ({}) });
  const tabB = await loadHandler({ entitlements: stable, upsellIntent: { id: 'pi_same', status: 'processing' }, patchEntitlements: async () => ({}) });
  await tabA.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern', idempotencyKey: 'random-1' }) });
  await tabB.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern', idempotencyKey: 'random-2' }) });
  assert.equal(tabA.createOptions[0].idempotencyKey, tabB.createOptions[0].idempotencyKey);
  assert.equal(tabA.createOptions[0].idempotencyKey, `lead_123:modern:w${now}:a0`);

  // 6. Generic decline: one retry allowed with a NEW key, then capped.
  const generic = new Error('Your card was declined.');
  generic.type = 'StripeCardError';
  generic.code = 'card_declined';
  generic.decline_code = 'generic_decline';
  const saved = [];
  const first = await loadHandler({ entitlements: stable, upsellError: generic, patchEntitlements: async (l, p) => { saved.push(p); return {}; } });
  const firstBody = JSON.parse((await first.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) })).body);
  assert.equal(firstBody.status, 'failed');
  assert.equal(firstBody.reason, 'declined');
  assert.equal(firstBody.attemptsRemaining, 1);
  assert.equal(firstBody.useDifferentCard, false);
  const afterFirst = saved[0].paymentAttempts.modern;
  assert.equal(afterFirst.failures, 1);

  const second = await loadHandler({ entitlements: paidEntitlements({ paymentAttempts: { modern: afterFirst } }), upsellError: generic, patchEntitlements: async (l, p) => { saved.push(p); return {}; } });
  const secondBody = JSON.parse((await second.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) })).body);
  assert.equal(second.createOptions[0].idempotencyKey, `lead_123:modern:w${now}:a1`, 'retry uses a new key');
  assert.equal(secondBody.reason, 'retry_limit');
  assert.equal(secondBody.useDifferentCard, true);
  assert.match(secondBody.message, /different card/);
  const afterSecond = saved[1].paymentAttempts.modern;

  const third = await loadHandler({ entitlements: paidEntitlements({ paymentAttempts: { modern: afterSecond } }), upsellIntent: { id: 'pi_never', status: 'succeeded' }, patchEntitlements: async () => ({}) });
  const thirdBody = JSON.parse((await third.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) })).body);
  assert.equal(third.createCalls.length, 0, 'third try never reaches Stripe');
  assert.equal(thirdBody.reason, 'retry_limit');

  // 7. insufficient_funds: the same card is not offered again.
  const nsf = new Error('Your card has insufficient funds.');
  nsf.type = 'StripeCardError';
  nsf.code = 'card_declined';
  nsf.decline_code = 'insufficient_funds';
  const nsfSaved = [];
  const nsfFirst = await loadHandler({ entitlements: stable, upsellError: nsf, patchEntitlements: async (l, p) => { nsfSaved.push(p); return {}; } });
  const nsfBody = JSON.parse((await nsfFirst.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) })).body);
  assert.equal(nsfBody.reason, 'insufficient_funds');
  assert.equal(nsfBody.attemptsRemaining, 0);
  const nsfRetry = await loadHandler({ entitlements: paidEntitlements({ paymentAttempts: { modern: nsfSaved[0].paymentAttempts.modern } }), upsellIntent: { id: 'pi_never', status: 'succeeded' }, patchEntitlements: async () => ({}) });
  const nsfRetryBody = JSON.parse((await nsfRetry.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) })).body);
  assert.equal(nsfRetry.createCalls.length, 0);
  assert.equal(nsfRetryBody.reason, 'insufficient_funds');
  assert.match(nsfRetryBody.message, /different card/);

  // 8. A new card on file resets the cap.
  const newCard = await loadHandler({ entitlements: paidEntitlements({ defaultPaymentMethodId: 'pm_new', paymentAttempts: { modern: nsfSaved[0].paymentAttempts.modern } }), upsellIntent: { id: 'pi_new', status: 'succeeded' }, patchEntitlements: async (l, p) => ({ leadId: l, ...p }) });
  const newCardBody = JSON.parse((await newCard.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) })).body);
  assert.equal(newCard.createCalls.length, 1);
  assert.equal(newCard.createCalls[0].payment_method, 'pm_new');
  assert.equal(newCardBody.status, 'succeeded');

  // 9. A Stripe outage doesn't count against the customer's attempts.
  const outage = new Error('Stripe API unavailable');
  outage.type = 'StripeAPIError';
  const outageSaved = [];
  const outageRun = await loadHandler({ entitlements: stable, upsellError: outage, patchEntitlements: async (l, p) => { outageSaved.push(p); return {}; } });
  const outageBody = JSON.parse((await outageRun.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) })).body);
  assert.equal(outageBody.status, 'failed');
  assert.equal(outageBody.reason, 'error');
  assert.equal(outageSaved.length, 0);

  // 10. A click after an abandoned/failed 3-D Secure challenge looks up that
  //     payment instead of replaying a stale "requires_action".
  const pendingState = { windowStart: now, failures: 0, paymentMethodId: 'pm_test', pendingPaymentIntentId: 'pi_pending' };
  const stillPending = await loadHandler({ entitlements: paidEntitlements({ paymentAttempts: { modern: pendingState } }), pendingIntent: { id: 'pi_pending', status: 'requires_action', client_secret: 'pi_pending_secret' }, patchEntitlements: async () => ({}) });
  const stillPendingBody = JSON.parse((await stillPending.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) })).body);
  assert.equal(stillPendingBody.status, 'requires_action');
  assert.equal(stillPendingBody.clientSecret, 'pi_pending_secret');
  assert.equal(stillPending.createCalls.length, 0);

  const failed3ds = await loadHandler({ entitlements: paidEntitlements({ paymentAttempts: { modern: pendingState } }), pendingIntent: { id: 'pi_pending', status: 'requires_payment_method', last_payment_error: { code: 'payment_intent_authentication_failure' } }, upsellIntent: { id: 'pi_retry', status: 'succeeded' }, patchEntitlements: async (l, p) => ({ leadId: l, ...p }) });
  const failed3dsBody = JSON.parse((await failed3ds.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) })).body);
  assert.equal(failed3ds.createCalls.length, 1, 'one fresh attempt after a failed 3DS');
  assert.equal(failed3ds.createOptions[0].idempotencyKey, `lead_123:modern:w${now}:a1`);
  assert.equal(failed3dsBody.status, 'succeeded');

  const paid3dsPatches = [];
  const paid3ds = await loadHandler({ entitlements: paidEntitlements({ paymentAttempts: { modern: pendingState } }), pendingIntent: { id: 'pi_pending', status: 'succeeded' }, patchEntitlements: async (l, p) => { paid3dsPatches.push(p); return { leadId: l, ...p }; } });
  const paid3dsBody = JSON.parse((await paid3ds.handler({ httpMethod: 'POST', body: JSON.stringify({ product: 'modern' }) })).body);
  assert.equal(paid3ds.createCalls.length, 0, 'never charge again once the 3DS payment succeeded');
  assert.equal(paid3dsBody.status, 'succeeded');
  assert.equal(paid3dsPatches[0].paid27, true);
}

run()
  .then(runSecurityChecks)
  .then(() => console.log('charge-upsell flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
