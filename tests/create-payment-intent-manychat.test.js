const assert = require('assert');

function loadHandler() {
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const fnPath = require.resolve('../netlify/functions/create-payment-intent');
  delete require.cache[fnPath];

  const customersCreated = [];
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
          create: async (payload) => {
            customersCreated.push(payload);
            return { id: 'cus_manychat', metadata: payload.metadata || {} };
          },
          update: async () => ({}),
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
      getEntitlements: async () => ({ stripeCustomerId: null }),
      saveLead: async (leadId, answers) => savedLeads.push({ leadId, answers }),
      patchEntitlements: async (leadId, patch) => entitlementPatches.push({ leadId, patch }),
    },
  };

  return {
    handler: require('../netlify/functions/create-payment-intent').handler,
    customersCreated,
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
        manychat_contact_id: '123456789',
      },
    }),
  });
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(flow.customersCreated[0].metadata, {
    leadId: 'lead_123',
    manychat_contact_id: '123456789',
  });
  assert.deepEqual(flow.setupIntentsCreated[0].metadata, {
    leadId: 'lead_123',
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
