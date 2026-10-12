// GET /.netlify/functions/return-access?token=...
//
// Verifies a signed return token and returns the minimum profile data needed
// for the listing/renewal experience. The token is the authorization; raw lead
// IDs are not accepted by this endpoint.
//
// Two token kinds:
//   product 'apartment-results'          — from the customer's own emails
//     (welcome email etc.). Proves control of the inbox, so it restores the
//     signed payment session cookie for that lead ('paid' scope once the trial
//     card is on file, otherwise 'lead').
//   product 'apartment-results-preview'  — from the returning-renter email
//     lookup, which anyone can trigger by typing an email address. It NEVER
//     grants access to the existing profile or its saved card. If the renter
//     continues to checkout from the preview, they get a fresh profile seeded
//     with the non-sensitive search fields and pay with the card they enter.
const crypto = require('crypto');
const { verify } = require('./_lib/sign');
const { getLead, getEntitlements, saveLead, patchEntitlements } = require('./_lib/store');
const { listingAccessStatus, hasActiveListingAccess } = require('./_lib/listing-access');
const { issueSessionCookie, withCookie } = require('./_lib/session');

const PREVIEW_CLONE_FIELDS = [
  'email',
  'first_name',
  'preferred_city',
  'city',
  'rent_budget',
  'beds_needed',
  'move_timeline',
  'move_reason',
  'entry_intent',
];

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function newLeadId() {
  return crypto.randomUUID ? crypto.randomUUID() : `lead_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
}

async function handlePreviewToken(event, data) {
  const lead = await getLead(data.leadId);
  if (!lead) {
    return json(404, { ok: false, error: 'We could not find this RentReady profile.' });
  }
  const entitlements = await getEntitlements(data.leadId);
  if (hasActiveListingAccess(entitlements)) {
    return json(403, {
      ok: false,
      code: 'sign_in_required',
      error: 'You already have active RentReady access. Open the secure link in your RentReady welcome email to sign in.',
    });
  }

  const leadId = newLeadId();
  const seeded = { lead_id: leadId, source: 'returning_email_preview' };
  PREVIEW_CLONE_FIELDS.forEach((field) => {
    if (lead[field] !== undefined && lead[field] !== null && lead[field] !== '') seeded[field] = lead[field];
  });
  await saveLead(leadId, seeded);
  await patchEntitlements(leadId, { sessionClaimedAt: new Date().toISOString() });

  return withCookie(
    json(200, {
      ok: true,
      lead: seeded,
      entitlements: { listingAccessStatus: 'inactive', listingSubscriptionStatus: 'inactive' },
    }),
    issueSessionCookie(event, leadId, 'lead')
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { Allow: 'GET' }, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  const token = (event.queryStringParameters || {}).token || '';
  const data = verify(token);
  if (data && data.product === 'apartment-results-preview' && data.leadId) {
    try {
      return await handlePreviewToken(event, data);
    } catch (err) {
      console.error('return-access preview error', err);
      return json(500, { ok: false, error: 'Could not verify this access link right now.' });
    }
  }
  if (!data || data.product !== 'apartment-results' || !data.leadId) {
    return json(403, { ok: false, error: 'This secure link has expired. Request a new access link from RentReady.' });
  }

  try {
    const lead = await getLead(data.leadId);
    if (!lead) {
      return json(404, { ok: false, error: 'We could not find this RentReady profile.' });
    }
    const entitlements = await getEntitlements(data.leadId);
    const scope = entitlements.paid10 && entitlements.defaultPaymentMethodId ? 'paid' : 'lead';
    return withCookie(
      json(200, {
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
      issueSessionCookie(event, data.leadId, scope)
    );
  } catch (err) {
    console.error('return-access error', err);
    return json(500, { ok: false, error: 'Could not verify this access link right now.' });
  }
};
