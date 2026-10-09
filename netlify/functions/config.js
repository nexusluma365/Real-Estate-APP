// Publishable keys are public by design. The key served to the browser must be
// in the same mode (test/live) as STRIPE_SECRET_KEY, so switching the secret
// key in Netlify switches the whole site between test and live payments.
function stripeKeyMode(key) {
  const value = String(key || '');
  if (value.startsWith('pk_test_') || value.startsWith('sk_test_')) return 'test';
  if (value.startsWith('pk_live_') || value.startsWith('sk_live_')) return 'live';
  return '';
}

const LOCAL_TEST_STRIPE_PUBLISHABLE_KEY =
  'pk_test_51UFFsZAYPiGDuG9e6Y8IS6i69lBTeKG9VLmMNUH6J0Ku6SrjzTOfqJZeEi2rrfri2Ive2zL4trt4fSXCWnLRVMSS00RNMFJPu4';

function googleAdsConfig() {
  const subscriptionLabel = (
    process.env.GOOGLE_ADS_NEW_SUBSCRIBER_LABEL ||
    process.env.GOOGLE_ADS_SUBSCRIPTION_LABEL ||
    process.env.GOOGLE_ADS_PURCHASE_LABEL ||
    process.env.VITE_GOOGLE_ADS_NEW_SUBSCRIBER_LABEL ||
    process.env.VITE_GOOGLE_ADS_SUBSCRIPTION_LABEL ||
    process.env.VITE_GOOGLE_ADS_PURCHASE_LABEL ||
    ''
  ).trim();
  return {
    id: (process.env.GOOGLE_ADS_ID || process.env.VITE_GOOGLE_ADS_ID || 'AW-18213168150').trim(),
    newSubscriberLabel: subscriptionLabel,
    // Backwards-compatible name used by older checkout builds.
    purchaseLabel: subscriptionLabel,
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { Allow: 'GET' },
      body: JSON.stringify({ ok: false, error: 'Method not allowed' }),
    };
  }

  const secretMode = stripeKeyMode(process.env.STRIPE_SECRET_KEY);
  const configuredKeys = [
    process.env.STRIPE_PUBLISHABLE_KEY,
    process.env.STRIPE_PUBLIC_KEY,
    process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY,
    process.env.VITE_STRIPE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    process.env.NETLIFY_DEV === 'true' ? LOCAL_TEST_STRIPE_PUBLISHABLE_KEY : '',
  ].filter(Boolean);
  const wantedMode = secretMode || '';
  const stripePublishableKey = wantedMode
    ? configuredKeys.find((key) => stripeKeyMode(key) === wantedMode)
    : configuredKeys.find((key) => stripeKeyMode(key));

  const publishableMode = stripeKeyMode(stripePublishableKey);
  const modeMismatch = secretMode && publishableMode && secretMode !== publishableMode;
  const missingKey = !stripePublishableKey;

  return {
    statusCode: modeMismatch ? 409 : missingKey ? 503 : 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ok: !!stripePublishableKey && !modeMismatch,
      stripePublishableKey: modeMismatch || missingKey ? '' : stripePublishableKey,
      stripeMode: publishableMode || null,
      googleAds: googleAdsConfig(),
      error: modeMismatch
        ? `Stripe key mode mismatch: browser publishable key is ${publishableMode}, but STRIPE_SECRET_KEY is ${secretMode}. Use matching Stripe keys in Netlify.`
        : missingKey
        ? 'STRIPE_PUBLISHABLE_KEY is not configured.'
        : null,
    }),
  };
};
