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
  const oldGoogleAdsId = process.env.GOOGLE_ADS_ID;
  const oldGoogleNewSubscriberLabel = process.env.GOOGLE_ADS_NEW_SUBSCRIBER_LABEL;
  const oldGoogleSubscriptionLabel = process.env.GOOGLE_ADS_SUBSCRIPTION_LABEL;
  const oldGooglePurchaseLabel = process.env.GOOGLE_ADS_PURCHASE_LABEL;

  try {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_PUBLIC_KEY;
    delete process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY;
    delete process.env.VITE_STRIPE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.GOOGLE_ADS_ID;
    delete process.env.GOOGLE_ADS_NEW_SUBSCRIBER_LABEL;
    delete process.env.GOOGLE_ADS_SUBSCRIPTION_LABEL;
    delete process.env.GOOGLE_ADS_PURCHASE_LABEL;

    const missingRes = await loadHandler()({ httpMethod: 'GET' });
    const missingBody = JSON.parse(missingRes.body);
    assert.equal(missingRes.statusCode, 503);
    assert.equal(missingBody.ok, false);
    assert.equal(missingBody.stripePublishableKey, '');
    assert.match(missingBody.error, /not configured/i);

    // A live publishable key in Netlify is rejected while the secret key is still test.
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_configured';
    process.env.STRIPE_SECRET_KEY = 'sk_test_backend';
    const mismatchRes = await loadHandler()({ httpMethod: 'GET' });
    const mismatchBody = JSON.parse(mismatchRes.body);
    assert.equal(mismatchRes.statusCode, 503);
    assert.equal(mismatchBody.ok, false);
    assert.equal(mismatchBody.stripePublishableKey, '');

    // Switching the secret key to live switches the browser key to live.
    process.env.STRIPE_SECRET_KEY = 'sk_live_backend';
    const liveRes = await loadHandler()({ httpMethod: 'GET' });
    const liveBody = JSON.parse(liveRes.body);
    assert.equal(liveRes.statusCode, 200);
    assert.equal(liveBody.ok, true);
    assert.equal(liveBody.stripeMode, 'live');
    assert.equal(liveBody.stripePublishableKey, 'pk_live_configured');
    assert.equal(liveBody.googleAds.id, 'AW-18213168150');
    assert.equal(liveBody.googleAds.newSubscriberLabel, '');

    // With no live key in Netlify, checkout fails safe instead of using a built-in fallback.
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    const missingLiveRes = await loadHandler()({ httpMethod: 'GET' });
    const missingLiveBody = JSON.parse(missingLiveRes.body);
    assert.equal(missingLiveRes.statusCode, 503);
    assert.equal(missingLiveBody.ok, false);
    assert.equal(missingLiveBody.stripePublishableKey, '');

    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_configured';
    process.env.STRIPE_SECRET_KEY = 'sk_test_backend';
    process.env.GOOGLE_ADS_ID = 'AW-configured';
    process.env.GOOGLE_ADS_NEW_SUBSCRIBER_LABEL = 'new_subscriber_label';
    const configuredRes = await loadHandler()({ httpMethod: 'GET' });
    const configuredBody = JSON.parse(configuredRes.body);
    assert.equal(configuredRes.statusCode, 200);
    assert.equal(configuredBody.ok, true);
    assert.equal(configuredBody.stripePublishableKey, 'pk_test_configured');
    assert.equal(configuredBody.googleAds.id, 'AW-configured');
    assert.equal(configuredBody.googleAds.newSubscriberLabel, 'new_subscriber_label');
    assert.equal(configuredBody.googleAds.purchaseLabel, 'new_subscriber_label');
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
    if (oldGoogleAdsId === undefined) delete process.env.GOOGLE_ADS_ID;
    else process.env.GOOGLE_ADS_ID = oldGoogleAdsId;
    if (oldGoogleNewSubscriberLabel === undefined) delete process.env.GOOGLE_ADS_NEW_SUBSCRIBER_LABEL;
    else process.env.GOOGLE_ADS_NEW_SUBSCRIBER_LABEL = oldGoogleNewSubscriberLabel;
    if (oldGoogleSubscriptionLabel === undefined) delete process.env.GOOGLE_ADS_SUBSCRIPTION_LABEL;
    else process.env.GOOGLE_ADS_SUBSCRIPTION_LABEL = oldGoogleSubscriptionLabel;
    if (oldGooglePurchaseLabel === undefined) delete process.env.GOOGLE_ADS_PURCHASE_LABEL;
    else process.env.GOOGLE_ADS_PURCHASE_LABEL = oldGooglePurchaseLabel;
  }
}

run()
  .then(() => console.log('config stripe key mode test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
