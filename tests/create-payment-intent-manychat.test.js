const assert = require('assert');

function loadHandler(options = {}) {
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const fnPath = require.resolve('../netlify/functions/create-payment-intent');
  delete require.cache[fnPath];

  const customersCreated = [];
  const customersUpdated = [];
  const setupIntentsCreated = [];
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
          create: async (payload) => {
            setupIntentsCreated.push(payload);
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
      getLead: async () => null,
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
}

run()
  .then(() => console.log('create-payment-intent manychat test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
