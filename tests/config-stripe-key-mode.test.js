const assert = require('assert');

function loadHandler() {
  const fnPath = require.resolve('../netlify/functions/config');
  delete require.cache[fnPath];
  return require('../netlify/functions/config').handler;
}

async function run() {
  const oldPublishable = process.env.STRIPE_PUBLISHABLE_KEY;
  const oldPublic = process.env.STRIPE_PUBLIC_KEY;
  const oldPublicStripe = process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const oldVite = process.env.VITE_STRIPE_PUBLISHABLE_KEY;
  const oldNext = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const oldSecret = process.env.STRIPE_SECRET_KEY;

  try {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_PUBLIC_KEY;
    delete process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
    delete process.env.VITE_STRIPE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_SECRET_KEY;

    const fallbackRes = await loadHandler()({ httpMethod: 'GET' });
    const fallbackBody = JSON.parse(fallbackRes.body);
    assert.equal(fallbackRes.statusCode, 200);
    assert.equal(fallbackBody.ok, true);
    assert.match(fallbackBody.stripePublishableKey, /^pk_test_/);
    assert.equal(fallbackBody.stripeMode, 'test');

    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_should_not_be_used_in_test_mode';
    process.env.STRIPE_SECRET_KEY = 'sk_live_backend';
    const mismatchRes = await loadHandler()({ httpMethod: 'GET' });
    const mismatchBody = JSON.parse(mismatchRes.body);
    assert.equal(mismatchRes.statusCode, 409);
    assert.equal(mismatchBody.ok, false);
    assert.equal(mismatchBody.stripePublishableKey, '');
    assert.match(mismatchBody.error, /mode mismatch/i);
    assert.match(mismatchBody.error, /test/);
    assert.match(mismatchBody.error, /live/);

    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_configured';
    process.env.STRIPE_SECRET_KEY = 'sk_test_backend';
    const configuredRes = await loadHandler()({ httpMethod: 'GET' });
    const configuredBody = JSON.parse(configuredRes.body);
    assert.equal(configuredRes.statusCode, 200);
    assert.equal(configuredBody.ok, true);
    assert.equal(configuredBody.stripePublishableKey, 'pk_test_configured');
  } finally {
    if (oldPublishable === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = oldPublishable;
    if (oldPublic === undefined) delete process.env.STRIPE_PUBLIC_KEY;
    else process.env.STRIPE_PUBLIC_KEY = oldPublic;
    if (oldPublicStripe === undefined) delete process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
    else process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY = oldPublicStripe;
    if (oldVite === undefined) delete process.env.VITE_STRIPE_PUBLISHABLE_KEY;
    else process.env.VITE_STRIPE_PUBLISHABLE_KEY = oldVite;
    if (oldNext === undefined) delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = oldNext;
    if (oldSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = oldSecret;
  }
}

run()
  .then(() => console.log('config stripe key mode test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
