const assert = require('assert');

function loadModule({ lead }) {
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const fnPath = require.resolve('../netlify/functions/_lib/welcome-email');
  delete require.cache[fnPath];

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: { getLead: async () => lead },
  };

  return require('../netlify/functions/_lib/welcome-email');
}

async function run() {
  const oldGoogleUrl = process.env.GOOGLE_SCRIPT_URL;
  const oldSiteUrl = process.env.URL;
  const oldFetch = global.fetch;

  try {
    process.env.GOOGLE_SCRIPT_URL = 'https://script.google.test/exec';
    process.env.URL = 'https://werentreadygo.com';

    const sent = [];
    global.fetch = async (url, options) => {
      sent.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    };

    const { sendWelcomeEmail } = loadModule({ lead: { email: ' USER@Example.COM ', first_name: 'Pat' } });
    await sendWelcomeEmail('lead_123');

    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, process.env.GOOGLE_SCRIPT_URL);
    assert.equal(sent[0].body.action, 'sendWelcomeEmail');
    assert.equal(sent[0].body.to, 'user@example.com');
    assert.equal(sent[0].body.firstName, 'Pat');
    assert.equal(sent[0].body.resultsUrl, 'https://werentreadygo.com/after-payment-results/');

    // No email on file (or invalid) must not call out at all.
    sent.length = 0;
    const { sendWelcomeEmail: sendNoEmail } = loadModule({ lead: { email: 'not-an-email' } });
    await sendNoEmail('lead_456');
    assert.equal(sent.length, 0);

    // GOOGLE_SCRIPT_URL not configured must also skip silently, not throw.
    sent.length = 0;
    delete process.env.GOOGLE_SCRIPT_URL;
    const { sendWelcomeEmail: sendUnconfigured } = loadModule({ lead: { email: 'renter@example.com' } });
    await sendUnconfigured('lead_789');
    assert.equal(sent.length, 0);

    // A failed send must throw, so callers can log it (but they choose to
    // swallow it rather than fail the payment confirmation).
    process.env.GOOGLE_SCRIPT_URL = 'https://script.google.test/exec';
    global.fetch = async () => ({ ok: true, json: async () => ({ ok: false, error: 'Apps Script quota exceeded' }) });
    const { sendWelcomeEmail: sendFailing } = loadModule({ lead: { email: 'renter@example.com' } });
    await assert.rejects(() => sendFailing('lead_999'));
  } finally {
    if (oldGoogleUrl === undefined) delete process.env.GOOGLE_SCRIPT_URL;
    else process.env.GOOGLE_SCRIPT_URL = oldGoogleUrl;
    if (oldSiteUrl === undefined) delete process.env.URL;
    else process.env.URL = oldSiteUrl;
    global.fetch = oldFetch;
  }
}

run()
  .then(() => console.log('welcome-email test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
