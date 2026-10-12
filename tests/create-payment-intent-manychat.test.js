const assert = require('assert');
const { withSession, sessionFromSetCookie } = require('./_session-helper');

function loadHandler(options = {}) {
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const fnPath = require.resolve('../netlify/functions/create-payment-intent');
  delete require.cache[fnPath];

  const customersCreated = [];
  const customersUpdated = [];
  const setupIntentsCreated = [];
  const setupIntentCreateOptions = [];
  const savedLeads = [];
  const entitlementPatches = [];
  process.env.STRIPE_LISTING_PRICE_MONTHLY = 'price_listing_monthly';

  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      getStripe: () => ({
        customers: {
          search: async () => ({ data: [] }),
          retrieve: async () => options.existingCustomer || { id: 'cus_existing', metadata: {} },
          create: async (payload) => {
            customersCreated.push(payload);
            return { id: 'cus_manychat', metadata: payload.metadata || {} };
          },
          update: async (id, payload) => {
            customersUpdated.push({ id, payload });
            return { id, ...payload };
          },
        },
        setupIntents: {
          retrieve: async (id) => (options.previousSetupIntent && options.previousSetupIntent.id === id ? options.previousSetupIntent : null),
          create: async (payload, opts) => {
            setupIntentsCreated.push(payload);
            setupIntentCreateOptions.push(opts);
            return {
              id: 'seti_manychat',
              status: 'requires_payment_method',
              client_secret: 'seti_manychat_secret',
            };
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
      getLead: async () => options.existingLead || null,
      getEntitlements: async () => options.existingEntitlements || { stripeCustomerId: null },
      saveLead: async (leadId, answers) => savedLeads.push({ leadId, answers }),
      patchEntitlements: async (leadId, patch) => entitlementPatches.push({ leadId, patch }),
    },
  };

  return {
    handler: require('../netlify/functions/create-payment-intent').handler,
    customersCreated,
    customersUpdated,
    setupIntentsCreated,
    setupIntentCreateOptions,
    savedLeads,
    entitlementPatches,
  };
}

async function run() {
  const flow = loadHandler();
  const res = await flow.handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      leadId: 'lead_123',
      email: 'test@example.com',
      answers: {
        lead_id: 'lead_123',
        email: 'test@example.com',
        first_name: 'Rae',
        last_name: 'Jordan',
        manychat_contact_id: '123456789',
      },
    }),
  });
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
  assert.equal(flow.customersCreated[0].email, 'test@example.com');
  assert.equal(flow.customersCreated[0].name, 'Rae Jordan');
  assert.deepEqual(flow.customersCreated[0].metadata, {
    leadId: 'lead_123',
    email: 'test@example.com',
    first_name: 'Rae',
    last_name: 'Jordan',
    full_name: 'Rae Jordan',
    manychat_contact_id: '123456789',
  });
  assert.deepEqual(flow.setupIntentsCreated[0].metadata, {
    leadId: 'lead_123',
    email: 'test@example.com',
    first_name: 'Rae',
    last_name: 'Jordan',
    full_name: 'Rae Jordan',
    manychat_contact_id: '123456789',
    product: 'listing_membership',
    plan: 'trial_then_monthly',
  });
  assert.deepEqual(flow.setupIntentsCreated[0].payment_method_types, ['card']);
  assert.equal(flow.setupIntentsCreated[0].usage, 'off_session');
  assert.equal(flow.savedLeads[0].answers.manychat_contact_id, '123456789');
  assert.equal(flow.entitlementPatches[0].patch.manychat_contact_id, '123456789');
  assert.equal(flow.entitlementPatches[0].patch.listingSetupIntentId, 'seti_manychat');
  assert.equal(flow.entitlementPatches[0].patch.listingAccessStatus, 'inactive');

  const existingCustomer = loadHandler({
    existingEntitlements: { stripeCustomerId: 'cus_existing' },
    existingCustomer: { id: 'cus_existing', email: 'old@example.com', name: null, metadata: { leadId: 'lead_existing' } },
  });
  await existingCustomer.handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      leadId: 'lead_existing',
      email: 'existing@example.com',
      answers: {
        lead_id: 'lead_existing',
        email: 'existing@example.com',
        first_name: 'Existing',
        last_name: 'Renter',
      },
    }),
  });
  assert.equal(existingCustomer.customersCreated.length, 0);
  assert.equal(existingCustomer.customersUpdated[0].id, 'cus_existing');
  assert.equal(existingCustomer.customersUpdated[0].payload.email, 'existing@example.com');
  assert.equal(existingCustomer.customersUpdated[0].payload.name, 'Existing Renter');
  assert.equal(existingCustomer.customersUpdated[0].payload.metadata.full_name, 'Existing Renter');

  const invalid = loadHandler();
  await invalid.handler({
    httpMethod: 'POST',
    body: JSON.stringify({
      leadId: 'lead_456',
      email: 'test@example.com',
      answers: {
        lead_id: 'lead_456',
        email: 'test@example.com',
        manychat_contact_id: '<script>',
      },
    }),
  });
  assert.equal(invalid.setupIntentsCreated[0].metadata.manychat_contact_id, undefined);

  // A brand-new (unclaimed) lead is claimed here and gets a session cookie.
  assert.equal(sessionFromSetCookie(res).leadId, 'lead_123');
  assert.equal(sessionFromSetCookie(res).scope, 'lead');
  assert.ok(flow.entitlementPatches[0].patch.sessionClaimedAt);

  const checkoutBody = (leadId) => JSON.stringify({ leadId, email: 'owner@example.com', answers: { lead_id: leadId, email: 'owner@example.com' } });

  // A lead someone else already claimed can't be driven with a bare leadId:
  // no customer/email changes, no SetupIntent.
  const claimed = loadHandler({
    existingLead: { lead_id: 'lead_owned', email: 'owner@example.com' },
    existingEntitlements: { stripeCustomerId: 'cus_existing', sessionClaimedAt: '2026-10-01T00:00:00.000Z' },
  });
  const claimedRes = await claimed.handler({ httpMethod: 'POST', body: checkoutBody('lead_owned') });
  assert.equal(claimedRes.statusCode, 401);
  assert.equal(claimed.customersUpdated.length, 0);
  assert.equal(claimed.customersCreated.length, 0);
  assert.equal(claimed.setupIntentsCreated.length, 0);

  // Same lead with its session cookie works.
  const owner = loadHandler({
    existingLead: { lead_id: 'lead_owned', email: 'owner@example.com' },
    existingEntitlements: { stripeCustomerId: 'cus_existing', sessionClaimedAt: '2026-10-01T00:00:00.000Z' },
  });
  const ownerRes = await owner.handler(withSession({ httpMethod: 'POST', body: checkoutBody('lead_owned') }, 'lead_owned', 'lead'));
  assert.equal(ownerRes.statusCode, 200);
  assert.equal(owner.setupIntentsCreated.length, 1);

  // A paid lead (card on file) is never claimable without a session, even if
  // it predates session cookies.
  const legacyPaid = loadHandler({
    existingLead: { lead_id: 'lead_paid', email: 'owner@example.com' },
    existingEntitlements: { paid10: true, defaultPaymentMethodId: 'pm_saved', stripeCustomerId: 'cus_existing' },
  });
  assert.equal((await legacyPaid.handler({ httpMethod: 'POST', body: checkoutBody('lead_paid') })).statusCode, 401);
  assert.equal(legacyPaid.setupIntentsCreated.length, 0);

  // Active trial: don't start a second checkout.
  const active = loadHandler({
    existingLead: { lead_id: 'lead_active' },
    existingEntitlements: { paid10: true, listingSubscriptionStatus: 'trialing', stripeCustomerId: 'cus_existing', sessionClaimedAt: 'x' },
  });
  const activeRes = await active.handler(withSession({ httpMethod: 'POST', body: checkoutBody('lead_active') }, 'lead_active', 'paid'));
  assert.equal(activeRes.statusCode, 409);
  assert.equal(active.setupIntentsCreated.length, 0);
  // ...and a 'paid' session is never downgraded to 'lead'.
  assert.equal(sessionFromSetCookie(activeRes).scope, 'paid');

  // After a card was rejected, a NEW SetupIntent is created (the old fixed
  // idempotency key returned the finished one forever).
  const afterReject = loadHandler({
    existingLead: { lead_id: 'lead_retry' },
    existingEntitlements: { stripeCustomerId: 'cus_existing', sessionClaimedAt: 'x', listingSetupIntentId: 'seti_old', rejectedSetupIntentId: 'seti_old' },
    existingCustomer: { id: 'cus_existing', metadata: {} },
    previousSetupIntent: { id: 'seti_old', status: 'succeeded', customer: 'cus_existing', client_secret: 'old_secret' },
  });
  const afterRejectRes = await afterReject.handler(withSession({ httpMethod: 'POST', body: checkoutBody('lead_retry') }, 'lead_retry', 'lead'));
  assert.equal(afterRejectRes.statusCode, 200);
  assert.equal(afterReject.setupIntentsCreated.length, 1);
  assert.equal(afterReject.setupIntentCreateOptions[0].idempotencyKey, 'lead_retry:listing-setup-intent:after-seti_old');

  // Regression (found in end-to-end run): confirm-intent clears
  // listingSetupIntentId on rejection; the next checkout must still get a
  // NEW SetupIntent instead of replaying the first idempotency key.
  const clearedAfterReject = loadHandler({
    existingLead: { lead_id: 'lead_retry2' },
    existingEntitlements: { stripeCustomerId: 'cus_existing', sessionClaimedAt: 'x', listingSetupIntentId: null, rejectedSetupIntentId: 'seti_rejected' },
    existingCustomer: { id: 'cus_existing', metadata: {} },
  });
  await clearedAfterReject.handler(withSession({ httpMethod: 'POST', body: checkoutBody('lead_retry2') }, 'lead_retry2', 'lead'));
  assert.equal(clearedAfterReject.setupIntentCreateOptions[0].idempotencyKey, 'lead_retry2:listing-setup-intent:after-seti_rejected');

  // Page refresh with an unfinished SetupIntent reuses it.
  const refresh = loadHandler({
    existingLead: { lead_id: 'lead_refresh' },
    existingEntitlements: { stripeCustomerId: 'cus_existing', sessionClaimedAt: 'x', listingSetupIntentId: 'seti_open' },
    existingCustomer: { id: 'cus_existing', metadata: {} },
    previousSetupIntent: { id: 'seti_open', status: 'requires_payment_method', customer: 'cus_existing', client_secret: 'open_secret' },
  });
  const refreshBody = JSON.parse((await refresh.handler(withSession({ httpMethod: 'POST', body: checkoutBody('lead_refresh') }, 'lead_refresh', 'lead'))).body);
  assert.equal(refresh.setupIntentsCreated.length, 0);
  assert.equal(refreshBody.clientSecret, 'open_secret');
}

run()
  .then(() => console.log('create-payment-intent manychat test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
