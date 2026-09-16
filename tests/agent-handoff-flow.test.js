const assert = require('assert');

function loadHandler({ lead, fetchImpl } = {}) {
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const fnPath = require.resolve('../netlify/functions/agent-handoff');
  delete require.cache[fnPath];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getLead: async () => lead || null,
    },
  };
  const oldFetch = global.fetch;
  if (fetchImpl) global.fetch = fetchImpl;
  return {
    handler: require('../netlify/functions/agent-handoff').handler,
    restore: () => {
      global.fetch = oldFetch;
    },
  };
}

async function run() {
  const oldWebhook = process.env.N8N_AGENT_HANDOFF_WEBHOOK_URL;
  try {
    delete process.env.N8N_AGENT_HANDOFF_WEBHOOK_URL;
    const stub = loadHandler({
      lead: {
        lead_id: 'lead_agent_123',
        email: 'rae@example.com',
        first_name: 'Rae',
        last_name: 'Ready',
        phone: '7045550100',
        contact_method: 'sms',
        preferred_city: 'Charlotte, NC',
        move_timeline: 'asap',
        annual_income: 72000,
        rent_budget: 1800,
        credit_score: '700_739',
        beds_needed: '1',
      },
    });
    const res = await stub.handler({ httpMethod: 'POST', body: JSON.stringify({ leadId: 'lead_agent_123' }) });
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.mode, 'stub');
    assert.equal(body.webhookConfigured, false);
    assert.equal(body.handoff.agent_status, 'sales-ready');
    assert.equal(body.handoff.agent_intent, 'urgent_move');
    stub.restore();

    let forwardedPayload = null;
    process.env.N8N_AGENT_HANDOFF_WEBHOOK_URL = 'https://n8n.example.test/webhook/rentready';
    const forwarded = loadHandler({
      lead: null,
      fetchImpl: async (url, options) => {
        assert.equal(url, process.env.N8N_AGENT_HANDOFF_WEBHOOK_URL);
        forwardedPayload = JSON.parse(options.body);
        return { ok: true, status: 200, text: async () => 'accepted' };
      },
    });
    const forwardedRes = await forwarded.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        lead: {
          lead_id: 'lead_inline',
          email: 'inline@example.com',
          first_name: 'In',
          last_name: 'Line',
          phone: '7045550100',
          contact_method: 'email',
          preferred_city: 'Austin, TX',
          move_timeline: 'flexible',
          annual_income: 90000,
          rent_budget: 2000,
          credit_score: '740_799',
          beds_needed: '2',
        },
      }),
    });
    const forwardedBody = JSON.parse(forwardedRes.body);
    assert.equal(forwardedBody.mode, 'forwarded');
    assert.equal(forwardedBody.ok, true);
    assert.equal(forwardedPayload.lead_id, 'lead_inline');
    assert.equal(forwardedPayload.agent_status, 'sales-ready');
    forwarded.restore();
  } finally {
    if (oldWebhook === undefined) delete process.env.N8N_AGENT_HANDOFF_WEBHOOK_URL;
    else process.env.N8N_AGENT_HANDOFF_WEBHOOK_URL = oldWebhook;
  }
}

run()
  .then(() => console.log('agent handoff flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
