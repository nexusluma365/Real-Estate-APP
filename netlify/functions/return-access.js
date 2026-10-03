// GET /.netlify/functions/return-access?token=...
//
// Verifies a signed email return token and returns the minimum profile data
// needed for the listing/renewal experience. The token is the authorization;
// raw lead IDs are not accepted by this endpoint.
const { verify } = require('./_lib/sign');
const { getLead, getEntitlements } = require('./_lib/store');
const { listingAccessStatus } = require('./_lib/listing-access');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { Allow: 'GET' }, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  const token = (event.queryStringParameters || {}).token || '';
  const data = verify(token);
  if (!data || data.product !== 'apartment-results' || !data.leadId) {
    return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'This secure link has expired. Request a new access link from RentReady.' }) };
  }

  try {
    const lead = await getLead(data.leadId);
    if (!lead) {
      return { statusCode: 404, body: JSON.stringify({ ok: false, error: 'We could not find this RentReady profile.' }) };
    }
    const entitlements = await getEntitlements(data.leadId);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        ok: true,
        lead: {
          ...lead,
          lead_id: data.leadId,
        },
        entitlements: {
          listingAccessStatus: listingAccessStatus(entitlements),
          listingSubscriptionStatus: entitlements.listingSubscriptionStatus || 'inactive',
        },
      }),
    };
  } catch (err) {
    console.error('return-access error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Could not verify this access link right now.' }) };
  }
};
