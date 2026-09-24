const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadWorker() {
  const source = fs
    .readFileSync('cloudflare/download-email-worker/src/worker.js', 'utf8')
    .replace(/export default\s*\{/, 'module.exports.default = {');
  const context = {
    module: { exports: {} },
    exports: {},
    console,
    URL,
    Request,
    Response,
    Headers,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Date,
    JSON,
    Math,
    btoa,
    atob,
    crypto,
    fetch: (...args) => global.fetch(...args),
  };
  vm.runInNewContext(source, context, { filename: 'worker.js' });
  return context.module.exports.default;
}

async function run() {
  const worker = loadWorker();
  const sentEmails = [];
  const files = {
    'RentReady Guide.zip': {
      body: 'ZIPDATA',
      httpMetadata: { contentType: 'application/zip' },
    },
  };

  const env = {
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SECRET_KEY: 'service-role',
    EMAIL_LINK_SECRET: 'email-secret',
    TRIGGER_SECRET: 'trigger-secret',
    RESEND_API_KEY: 'resend-secret',
    FROM_EMAIL: 'RentReady <support@example.com>',
    PUBLIC_WORKER_URL: 'https://worker.test',
    PUBLIC_SITE_URL: 'https://rentready.test',
    DOWNLOADS: {
      head: async (key) => files[key] || null,
      get: async (key) => files[key] || null,
    },
  };

  const oldFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.includes('/rest/v1/leads')) {
      return Response.json([{ id: 'lead_123', email: 'BUYER@Example.COM', first_name: 'Rae' }]);
    }
    if (href.includes('/rest/v1/entitlements')) {
      return Response.json([
        {
          lead_id: 'lead_123',
          paid27: true,
          paid97: false,
          purchased_category: 'luxury',
          raw_entitlement: { purchasedCategories: ['modern', 'luxury'] },
        },
      ]);
    }
    if (href === 'https://rentready.test/rentready-emails/guide-ready-email.html') {
      return new Response('<a href="{{DOWNLOAD_URL}}">Download</a>');
    }
    if (href === 'https://api.resend.com/emails') {
      const body = JSON.parse(options.body);
      sentEmails.push(body);
      return Response.json({ id: 'email_123' });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  try {
    const sendRes = await worker.fetch(
      new Request('https://worker.test/send-download', {
        method: 'POST',
        headers: { Authorization: 'Bearer trigger-secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: 'lead_123', product: 'modern' }),
      }),
      env
    );
    const sendBody = await sendRes.json();

    assert.equal(sendRes.status, 200);
    assert.deepEqual(sendBody, { ok: true, emailed: true, to: 'buyer@example.com' });
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, 'buyer@example.com');
    assert.equal(sentEmails[0].subject, 'Your RentReady Guide is Ready');
    assert.match(sentEmails[0].text, /https:\/\/worker\.test\/download\?token=/);
    assert.match(sentEmails[0].html, /https:\/\/worker\.test\/download\?token=/);

    const downloadUrl = sentEmails[0].text.match(/https:\/\/worker\.test\/download\?token=\S+/)[0];
    const downloadRes = await worker.fetch(new Request(downloadUrl), env);

    assert.equal(downloadRes.status, 200);
    assert.equal(downloadRes.headers.get('Content-Type'), 'application/zip');
    assert.equal(downloadRes.headers.get('Content-Disposition'), 'attachment; filename="RentReady Guide.zip"');
    assert.equal(await downloadRes.text(), 'ZIPDATA');

    const lockedRes = await worker.fetch(
      new Request('https://worker.test/send-download', {
        method: 'POST',
        headers: { Authorization: 'Bearer trigger-secret', 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: 'lead_123', product: 'creditkit' }),
      }),
      env
    );
    assert.equal(lockedRes.status, 403);
  } finally {
    global.fetch = oldFetch;
  }
}

run()
  .then(() => console.log('cloudflare download worker smoke test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
