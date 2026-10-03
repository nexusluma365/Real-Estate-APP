// GET /.netlify/functions/get-entitlements?leadId=...
//
// Frontend pages call this on load instead of trusting only their own
// sessionStorage flags, so a refresh, a back-button, or a returning
// customer on a new tab all see their real purchase state.
const { getEntitlements } = require('./_lib/store');
const { listingAccessStatus } = require('./_lib/listing-access');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const leadId = (event.queryStringParameters || {}).leadId;
  if (!leadId) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'leadId is required' }) };
  }

  try {
    const e = await getEntitlements(leadId);
    const purchasedCategories = Array.isArray(e.purchasedCategories) ? e.purchasedCategories : [];
    const hasApartmentPrep = !!e.paid47 || purchasedCategories.includes('apartment_prep');
    const hasLegacyPaid27Product = !!e.paid27 && purchasedCategories.some((category) => category !== 'apartment_prep');
    // Only ever hand the frontend the flags it needs to render — never the
    // Stripe customer/payment-method identifiers.
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        paid10: !!e.paid10,
        paid27: hasLegacyPaid27Product,
        paid47: hasApartmentPrep,
        paid97: !!e.paid97,
        purchasedCategory: e.purchasedCategory || null,
        purchasedCategories,
        membershipStatus: e.membershipStatus || 'inactive',
        membershipPlan: e.membershipPlan || null,
        listingAccessStatus: listingAccessStatus(e),
        listingSubscriptionStatus: e.listingSubscriptionStatus || 'inactive',
        listingSubscriptionCurrentPeriodEnd: e.listingSubscriptionCurrentPeriodEnd || null,
        listingSubscriptionCancelAtPeriodEnd: !!e.listingSubscriptionCancelAtPeriodEnd,
      }),
    };
  } catch (err) {
    console.error('get-entitlements error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Could not load status.' }) };
  }
};
