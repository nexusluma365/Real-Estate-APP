const TEST_STRIPE_PUBLISHABLE_KEY =
  'pk_test_51UFFsZAYPiGDuG9e6Y8IS6i69lBTeKG9VLmMNUH6J0Ku6SrjzTOfqJZeEi2rrfri2Ive2zL4trt4fSXCWnLRVMSS00RNMFJPu4';

function stripeKeyMode(key) {
  const value = String(key || '');
  if (value.startsWith('pk_test_') || value.startsWith('sk_test_')) return 'test';
  if (value.startsWith('pk_live_') || value.startsWith('sk_live_')) return 'live';
  return '';
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: { Allow: 'GET' },
      body: JSON.stringify({ ok: false, error: 'Method not allowed' }),
    };
  }

  const stripePublishableKey =
    [
      process.env.STRIPE_PUBLISHABLE_KEY,
      process.env.STRIPE_PUBLIC_KEY,
      process.env.PUBLIC_STRIPE_PUBLISHABLE_KEY,
      process.env.VITE_STRIPE_PUBLISHABLE_KEY,
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    ].find((key) => stripeKeyMode(key) === 'test') ||
    TEST_STRIPE_PUBLISHABLE_KEY;

  const publishableMode = stripeKeyMode(stripePublishableKey);
  const secretMode = stripeKeyMode(process.env.STRIPE_SECRET_KEY);
  const modeMismatch = secretMode && publishableMode && secretMode !== publishableMode;

  return {
    statusCode: modeMismatch ? 409 : stripePublishableKey ? 200 : 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify({
      ok: !!stripePublishableKey && !modeMismatch,
      stripePublishableKey: modeMismatch ? '' : stripePublishableKey,
      stripeMode: publishableMode || null,
      error: modeMismatch
        ? `Stripe key mode mismatch: browser publishable key is ${publishableMode}, but STRIPE_SECRET_KEY is ${secretMode}. Use matching test keys in Netlify.`
        : stripePublishableKey
        ? null
        : 'STRIPE_PUBLISHABLE_KEY is not configured.',
    }),
  };
};
