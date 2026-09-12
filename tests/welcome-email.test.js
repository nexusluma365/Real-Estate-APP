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
  const oldCloudflareUrl = process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
  const oldCloudflareWelcomeUrl = process.env.CLOUDFLARE_WELCOME_EMAIL_URL;
  const oldCloudflareSecret = process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET;
  const oldFetch = global.fetch;

  try {
    process.env.GOOGLE_SCRIPT_URL = 'https://script.google.test/exec';
    process.env.URL = 'https://werentreadygo.com';
    process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL = 'https://worker.test/send-download';
    process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET = 'trigger_secret';

    const sent = [];
    global.fetch = async (url, options) => {
      sent.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    };

    const { sendWelcomeEmail } = loadModule({ lead: { email: ' USER@Example.COM ', first_name: 'Pat' } });
    await sendWelcomeEmail('lead_123');

    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://worker.test/send-welcome');
    assert.equal(sent[0].headers.Authorization, 'Bearer trigger_secret');
    assert.equal(sent[0].body.leadId, 'lead_123');
    assert.equal(sent[0].body.resultsUrl, 'https://werentreadygo.com/after-payment-results/');

    // No email on file (or invalid) must not call out at all.
    sent.length = 0;
    const { sendWelcomeEmail: sendNoEmail } = loadModule({ lead: { email: 'not-an-email' } });
    await sendNoEmail('lead_456');
    assert.equal(sent.length, 0);

    // No delivery endpoint configured must skip silently, not throw.
    sent.length = 0;
    delete process.env.GOOGLE_SCRIPT_URL;
    delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
    delete process.env.CLOUDFLARE_WELCOME_EMAIL_URL;
    const { sendWelcomeEmail: sendUnconfigured } = loadModule({ lead: { email: 'renter@example.com' } });
    await sendUnconfigured('lead_789');
    assert.equal(sent.length, 0);

    // If Cloudflare is not configured, keep the Apps Script fallback.
    process.env.GOOGLE_SCRIPT_URL = 'https://script.google.test/exec';
    delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
    sent.length = 0;
    global.fetch = async (url, options) => {
      sent.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    };
    const { sendWelcomeEmail: sendFallback } = loadModule({ lead: { email: 'renter@example.com', first_name: 'Rae' } });
    await sendFallback('lead_fallback');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, process.env.GOOGLE_SCRIPT_URL);
    assert.equal(sent[0].body.action, 'sendWelcomeEmail');
    assert.equal(sent[0].body.to, 'renter@example.com');
    assert.equal(sent[0].body.firstName, 'Rae');
    assert.equal(sent[0].body.resultsUrl, 'https://werentreadygo.com/after-payment-results/');
    assert.equal(sent[0].body.templateBaseUrl, 'https://werentreadygo.com');

    // A failed primary send must throw, so callers can log it (but they choose to
    // swallow it rather than fail the payment confirmation).
    process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL = 'https://worker.test/send-download';
    global.fetch = async () => ({ ok: false, json: async () => ({ ok: false, error: 'Resend unavailable' }) });
    const { sendWelcomeEmail: sendFailing } = loadModule({ lead: { email: 'renter@example.com' } });
    await assert.rejects(() => sendFailing('lead_999'));
  } finally {
    if (oldGoogleUrl === undefined) delete process.env.GOOGLE_SCRIPT_URL;
    else process.env.GOOGLE_SCRIPT_URL = oldGoogleUrl;
    if (oldSiteUrl === undefined) delete process.env.URL;
    else process.env.URL = oldSiteUrl;
    if (oldCloudflareUrl === undefined) delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
    else process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL = oldCloudflareUrl;
    if (oldCloudflareWelcomeUrl === undefined) delete process.env.CLOUDFLARE_WELCOME_EMAIL_URL;
    else process.env.CLOUDFLARE_WELCOME_EMAIL_URL = oldCloudflareWelcomeUrl;
    if (oldCloudflareSecret === undefined) delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET;
    else process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET = oldCloudflareSecret;
    global.fetch = oldFetch;
  }
}

run()
  .then(() => console.log('welcome-email test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
