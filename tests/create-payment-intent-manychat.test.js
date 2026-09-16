const assert = require('assert');

function loadHandler() {
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const fnPath = require.resolve('../netlify/functions/create-payment-intent');
  delete require.cache[fnPath];

  const customersCreated = [];
  const paymentIntentsCreated = [];
  const savedLeads = [];
  const entitlementPatches = [];

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
        paymentIntents: {
          create: async (payload) => {
            paymentIntentsCreated.push(payload);
            return { id: 'pi_manychat', client_secret: 'pi_manychat_secret' };
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
      saveLead: async (leadId, answers) => savedLeads.push({ leadId, answers }),
      patchEntitlements: async (leadId, patch) => entitlementPatches.push({ leadId, patch }),
    },
  };

  return {
    handler: require('../netlify/functions/create-payment-intent').handler,
    customersCreated,
    paymentIntentsCreated,
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
  assert.deepEqual(flow.paymentIntentsCreated[0].metadata, {
    leadId: 'lead_123',
    manychat_contact_id: '123456789',
    product: 'prescreen',
  });
  assert.equal(flow.savedLeads[0].answers.manychat_contact_id, '123456789');
  assert.equal(flow.entitlementPatches[0].patch.manychat_contact_id, '123456789');

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
  assert.equal(invalid.paymentIntentsCreated[0].metadata.manychat_contact_id, undefined);
}

run()
  .then(() => console.log('create-payment-intent manychat test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
