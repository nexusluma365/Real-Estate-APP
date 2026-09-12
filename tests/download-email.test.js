const assert = require('assert');

function loadModule() {
  const fnPath = require.resolve('../netlify/functions/_lib/download-email');
  delete require.cache[fnPath];
  return require('../netlify/functions/_lib/download-email');
}

async function run() {
  const oldCloudflareUrl = process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
  const oldCloudflareSecret = process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET;
  const oldFetch = global.fetch;

  try {
    process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL = 'https://worker.test/send-download';
    process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET = 'trigger_secret';

    const sent = [];
    global.fetch = async (url, options) => {
      sent.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    };

    const { sendDownloadEmail } = loadModule();
    assert.equal(await sendDownloadEmail('lead_123', 'MODERN'), true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://worker.test/send-download');
    assert.equal(sent[0].headers.Authorization, 'Bearer trigger_secret');
    assert.deepEqual(sent[0].body, { leadId: 'lead_123', product: 'modern' });

    assert.equal(await sendDownloadEmail('lead_123', 'not-a-product'), false);
    assert.equal(sent.length, 1);

    global.fetch = async () => ({ ok: false, json: async () => ({ ok: false, error: 'locked' }) });
    await assert.rejects(() => sendDownloadEmail('lead_456', 'luxury'), /Cloudflare download email failed/);

    delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
    assert.equal(await sendDownloadEmail('lead_789', 'luxury'), false);
  } finally {
    if (oldCloudflareUrl === undefined) delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
    else process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL = oldCloudflareUrl;
    if (oldCloudflareSecret === undefined) delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET;
    else process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET = oldCloudflareSecret;
    global.fetch = oldFetch;
  }
}

run()
  .then(() => console.log('download email test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
