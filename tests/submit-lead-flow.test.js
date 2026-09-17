const assert = require('assert');

function loadHandler(options = {}) {
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const fnPath = require.resolve('../netlify/functions/submit-lead');
  delete require.cache[fnPath];

  const savedLeads = [];
  const lookedUpEmails = [];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      saveLead:
        options.saveLead ||
        (async (leadId, answers) => {
          savedLeads.push({ leadId, answers });
        }),
      getLeadByEmail:
        options.getLeadByEmail ||
        (async (email) => {
          lookedUpEmails.push(email);
          return null;
        }),
    },
  };

  return { handler: require('../netlify/functions/submit-lead').handler, savedLeads, lookedUpEmails };
}

async function run() {
  const oldGoogleUrl = process.env.GOOGLE_SCRIPT_URL;
  const oldFetch = global.fetch;

  try {
    delete process.env.GOOGLE_SCRIPT_URL;
    const missingSheets = loadHandler();
    const missingSheetsRes = await missingSheets.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        lead_id: 'lead_123',
        email: 'renter@example.com',
        preferred_city: 'High Point, NC',
      }),
    });
    const missingSheetsBody = JSON.parse(missingSheetsRes.body);

    assert.equal(missingSheetsRes.statusCode, 200);
    assert.equal(missingSheetsBody.ok, true);
    assert.equal(missingSheetsBody.saved, true);
    assert.equal(missingSheetsBody.sheetsOk, false);
    assert.match(missingSheetsBody.warning, /Google Sheets forwarding/);
    assert.equal(missingSheets.savedLeads.length, 1);
    assert.equal(missingSheets.savedLeads[0].leadId, 'lead_123');
    assert.equal(missingSheets.savedLeads[0].answers.preferred_city, 'High Point, NC');
    assert.equal(missingSheets.savedLeads[0].answers.email, 'renter@example.com');

    const registeredEmail = loadHandler({
      getLeadByEmail: async (email) => ({
        lead_id: 'lead_existing',
        email,
        preferred_city: 'Charlotte, NC',
      }),
    });
    const registeredEmailRes = await registeredEmail.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        lookupOnly: true,
        email: 'RENTER@EXAMPLE.COM',
      }),
    });
    const registeredEmailBody = JSON.parse(registeredEmailRes.body);

    assert.equal(registeredEmailRes.statusCode, 200);
    assert.equal(registeredEmailBody.ok, true);
    assert.equal(registeredEmailBody.registered, true);
    assert.equal(registeredEmailBody.lead.lead_id, 'lead_existing');
    assert.equal(registeredEmail.savedLeads.length, 0);

    const invalidEmail = loadHandler();
    const invalidEmailRes = await invalidEmail.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        lead_id: 'lead_invalid',
        email: 'not-an-email',
      }),
    });
    const invalidEmailBody = JSON.parse(invalidEmailRes.body);

    assert.equal(invalidEmailRes.statusCode, 400);
    assert.equal(invalidEmailBody.ok, false);
    assert.match(invalidEmailBody.error, /valid email/i);
    assert.equal(invalidEmail.savedLeads.length, 0);

    process.env.GOOGLE_SCRIPT_URL = 'https://script.google.test/exec';
    const forwarded = loadHandler();
    let forwardedPayload = null;
    global.fetch = async (url, options) => {
      assert.equal(url, process.env.GOOGLE_SCRIPT_URL);
      forwardedPayload = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({ ok: true, row: 42 }),
        text: async () => JSON.stringify({ ok: true, row: 42 }),
      };
    };

    const forwardedRes = await forwarded.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        lead_id: 'lead_456',
        submitted_at: '2026-09-10T18:28:00.000Z',
        first_name: 'Second',
        last_name: 'Renter',
        email: 'SECOND@EXAMPLE.COM',
        date_of_birth: '1992-04-03',
        move_timeline: '30_days',
        preferred_city: 'Charlotte, NC',
        move_reason: 'new_job',
        annual_income: 78000,
        credit_score: '700_739',
        beds_needed: '1,2',
        rent_budget: 2100,
        current_rent: 1650,
        contact_method: 'email',
        phone: '7045550100',
        source_page: 'https://werentreadygo.com/questionnaire',
        referrer: 'https://werentreadygo.com/',
        user_agent: 'submit-lead-test',
        manychat_contact_id: '123456789',
        agent_status: 'sales-ready',
        agent_intent: 'urgent_move',
        agent_activity: [{ type: 'handoff_ready', at: '2026-09-10T18:28:00.000Z', step: 'review' }],
      }),
    });
    const forwardedBody = JSON.parse(forwardedRes.body);

    assert.equal(forwardedRes.statusCode, 200);
    assert.equal(forwardedBody.ok, true);
    assert.equal(forwardedBody.saved, true);
    assert.equal(forwardedBody.sheetsOk, true);
    assert.equal(forwardedBody.error, undefined);
    assert.equal(forwarded.savedLeads.length, 1);
    assert.equal(forwarded.savedLeads[0].leadId, 'lead_456');
    assert.equal(forwardedPayload.lead_id, 'lead_456');
    assert.deepEqual(forwardedPayload, {
      lead_id: 'lead_456',
      submitted_at: '2026-09-10T18:28:00.000Z',
      first_name: 'Second',
      last_name: 'Renter',
      email: 'second@example.com',
      date_of_birth: '1992-04-03',
      move_timeline: '30_days',
      preferred_city: 'Charlotte, NC',
      move_reason: 'new_job',
      annual_income: 78000,
      credit_score: '700_739',
      beds_needed: '1,2',
      rent_budget: 2100,
      current_rent: 1650,
      contact_method: 'email',
      phone: '7045550100',
      source_page: 'https://werentreadygo.com/questionnaire',
      referrer: 'https://werentreadygo.com/',
      user_agent: 'submit-lead-test',
      manychat_contact_id: '123456789',
      agent_status: 'sales-ready',
      agent_intent: 'urgent_move',
      agent_activity: [{ type: 'handoff_ready', at: '2026-09-10T18:28:00.000Z', step: 'review', status: '', intent: '' }],
      agent_state: {
        agent: 'agent-number-one',
        version: '1.0',
        status: 'sales-ready',
        intent: 'urgent_move',
        current_step: 'handoff',
        handoff: {
          target: 'sales-agent',
          status: 'sales-ready',
          ready: true,
        },
      },
    });

    delete process.env.GOOGLE_SCRIPT_URL;
    const storageFailure = loadHandler({
      saveLead: async () => {
        throw new Error('blob write failed');
      },
    });
    const storageFailureRes = await storageFailure.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        lead_id: 'lead_789',
        email: 'third@example.com',
      }),
    });
    const storageFailureBody = JSON.parse(storageFailureRes.body);

    assert.equal(storageFailureRes.statusCode, 200);
    assert.equal(storageFailureBody.ok, false);
    assert.equal(storageFailureBody.saved, false);
    assert.equal(storageFailureBody.sheetsOk, false);
    assert.match(storageFailureBody.error, /Could not save questionnaire/);
  } finally {
    if (oldGoogleUrl === undefined) delete process.env.GOOGLE_SCRIPT_URL;
    else process.env.GOOGLE_SCRIPT_URL = oldGoogleUrl;
    global.fetch = oldFetch;
  }
}

run()
  .then(() => console.log('submit-lead flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
