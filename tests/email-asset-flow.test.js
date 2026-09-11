const assert = require('assert');

function loadHandler({ entitlements, lead }) {
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const signPath = require.resolve('../netlify/functions/_lib/sign');
  const fnPath = require.resolve('../netlify/functions/email-asset');
  delete require.cache[fnPath];

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getEntitlements: async () => entitlements,
      getLead: async () => lead,
    },
  };

  require.cache[signPath] = {
    id: signPath,
    filename: signPath,
    loaded: true,
    exports: {
      sign: (payload) => `signed:${payload.leadId}:${payload.product}:${payload.category || ''}`,
    },
  };

  return require('../netlify/functions/email-asset').handler;
}

async function run() {
  const oldGoogleUrl = process.env.GOOGLE_SCRIPT_URL;
  const oldCloudflareUrl = process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
  const oldCloudflareSecret = process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET;
  const oldUrl = process.env.URL;
  const oldFetch = global.fetch;

  try {
    delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
    delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET;
    process.env.GOOGLE_SCRIPT_URL = 'https://script.google.test/exec';
    process.env.URL = 'https://rentready.test';

    const sent = [];
    global.fetch = async (url, options) => {
      sent.push({ url, body: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    };

    const handler = loadHandler({
      entitlements: { paid27: true, purchasedCategories: ['modern'] },
      lead: { email: ' USER@Example.COM ', first_name: 'Pat' },
    });
    const res = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({ leadId: 'lead_123', type: 'apartment-results', category: 'modern' }),
    });
    const body = JSON.parse(res.body);

    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.to, 'user@example.com');
    assert.match(sent[0].body.downloadUrl, /get-apartment-results\?token=/);
    assert.equal(sent[0].body.templateBaseUrl, 'https://rentready.test');

    const invalidHandler = loadHandler({
      entitlements: { paid27: true, purchasedCategories: ['luxury'] },
      lead: { email: 'bad-email' },
    });
    const invalidRes = await invalidHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ leadId: 'lead_456', type: 'apartment-results', category: 'luxury' }),
    });
    const invalidBody = JSON.parse(invalidRes.body);

    assert.equal(invalidRes.statusCode, 400);
    assert.equal(invalidBody.ok, false);
    assert.equal(sent.length, 1);

    const lockedHandler = loadHandler({
      entitlements: { paid27: false, purchasedCategories: [] },
      lead: { email: 'locked@example.com' },
    });
    const lockedRes = await lockedHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ leadId: 'lead_789', type: 'apartment-results', category: 'modern' }),
    });
    const lockedBody = JSON.parse(lockedRes.body);

    assert.equal(lockedRes.statusCode, 403);
    assert.equal(lockedBody.ok, false);
    assert.equal(sent.length, 1);

    process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL = 'https://worker.test/send-download';
    process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET = 'secret_123';
    const cloudflareSent = [];
    global.fetch = async (url, options) => {
      cloudflareSent.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return {
        ok: true,
        json: async () => ({ ok: true }),
      };
    };

    const cloudflareHandler = loadHandler({
      entitlements: { paid27: true, purchasedCategories: ['luxury'] },
      lead: { email: 'buyer@example.com' },
    });
    const cloudflareRes = await cloudflareHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ leadId: 'lead_cf', type: 'apartment-results', category: 'luxury' }),
    });
    const cloudflareBody = JSON.parse(cloudflareRes.body);

    assert.equal(cloudflareRes.statusCode, 200);
    assert.equal(cloudflareBody.ok, true);
    assert.equal(cloudflareBody.provider, 'cloudflare-r2');
    assert.equal(cloudflareSent.length, 1);
    assert.equal(cloudflareSent[0].url, 'https://worker.test/send-download');
    assert.equal(cloudflareSent[0].headers.Authorization, 'Bearer secret_123');
    assert.deepEqual(cloudflareSent[0].body, { leadId: 'lead_cf', product: 'luxury' });

    // Regression: owning both apartment categories must allow emailing
    // either one's results, not just the most recently purchased category.
    const dualCategorySent = [];
    global.fetch = async (url, options) => {
      dualCategorySent.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ok: true }) };
    };
    delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
    delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET;
    const dualCategoryHandler = loadHandler({
      entitlements: { paid27: true, purchasedCategories: ['modern', 'luxury'] },
      lead: { email: 'dual@example.com' },
    });
    const dualCategoryRes = await dualCategoryHandler({
      httpMethod: 'POST',
      body: JSON.stringify({ leadId: 'lead_dual', type: 'apartment-results', category: 'modern' }),
    });
    assert.equal(dualCategoryRes.statusCode, 200);
    assert.equal(JSON.parse(dualCategoryRes.body).ok, true);
    assert.equal(dualCategorySent.length, 1);
  } finally {
    if (oldGoogleUrl === undefined) delete process.env.GOOGLE_SCRIPT_URL;
    else process.env.GOOGLE_SCRIPT_URL = oldGoogleUrl;
    if (oldCloudflareUrl === undefined) delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL;
    else process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL = oldCloudflareUrl;
    if (oldCloudflareSecret === undefined) delete process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET;
    else process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET = oldCloudflareSecret;
    if (oldUrl === undefined) delete process.env.URL;
    else process.env.URL = oldUrl;
    global.fetch = oldFetch;
  }
}

run()
  .then(() => console.log('email-asset flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
