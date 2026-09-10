// POST /.netlify/functions/email-asset
// Body: { leadId, type, category }   type: 'result'|'gameplan'|'creditkit'|'apartment-results'
//
// Reuses the Google Apps Script web app the questionnaire already submits
// to (see google-apps-script/code.gs) instead of adding a new email
// provider. It generates a signed, time-limited link (7 days) rather than
// emailing a permanently public URL, then asks Apps Script to send it.
const { getEntitlements, getLead } = require('./_lib/store');
const { sign } = require('./_lib/sign');
const { normalizeEmail, isValidEmail } = require('./_lib/email');

const FIELD_BY_TYPE = { result: 'paid10', gameplan: 'paid27', creditkit: 'paid97', 'apartment-results': 'paid27' };
const SUBJECT_BY_TYPE = {
  result: 'Your RentReady Pre-Screen Results',
  gameplan: 'Your RentReady Game Plan',
  creditkit: 'Your RentReady Credit Action Kit',
  'apartment-results': 'Your RentReady Apartment Results',
};

function cloudflareProduct(type, category) {
  if (type === 'apartment-results') return category;
  return type;
}

async function sendViaCloudflare({ leadId, type, category }) {
  const url = process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL || '';
  if (!url) return null;
  const product = cloudflareProduct(type, category);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET
        ? { Authorization: `Bearer ${process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET}` }
        : {}),
    },
    body: JSON.stringify({ leadId, product }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data || data.ok !== true) {
    console.error('Cloudflare download email failed', data);
    return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Could not send the email right now.' }) };
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true, provider: 'cloudflare-r2' }) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON body' }) };
  }

  const { leadId, type } = body;
  const category = String(body.category || '').toLowerCase();
  const field = FIELD_BY_TYPE[type];
  if (!leadId || !field) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing or invalid fields' }) };
  }

  try {
    const entitlements = await getEntitlements(leadId);
    if (!entitlements[field]) {
      return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Not unlocked yet.' }) };
    }
    if (type === 'apartment-results' && !['modern', 'luxury'].includes(category)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing apartment category.' }) };
    }
    if (type === 'apartment-results' && !(entitlements.purchasedCategories || []).includes(category)) {
      return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'This apartment category is not unlocked yet.' }) };
    }

    const lead = await getLead(leadId);
    const recipientEmail = normalizeEmail(lead && lead.email);
    if (!isValidEmail(recipientEmail)) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'No email on file for this account.' }) };
    }

    const cloudflareResult = await sendViaCloudflare({ leadId, type, category });
    if (cloudflareResult) return cloudflareResult;

    const siteUrl = process.env.URL || process.env.DEPLOY_URL || '';
    const token = sign({ leadId, product: type === 'apartment-results' ? 'apartment-results' : type === 'result' ? 'result' : type, category });
    const downloadUrl =
      type === 'result'
        ? `${siteUrl}/.netlify/functions/download-result-pdf?token=${encodeURIComponent(token)}`
        : type === 'apartment-results'
        ? `${siteUrl}/.netlify/functions/get-apartment-results?token=${encodeURIComponent(token)}`
        : `${siteUrl}/.netlify/functions/download-file?product=${type}&token=${encodeURIComponent(token)}`;

    const gasUrl = process.env.GOOGLE_SCRIPT_URL;
    if (!gasUrl || gasUrl.includes('PASTE_YOUR')) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Email delivery is not configured yet.' }) };
    }

    const resp = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'sendEmail',
        to: recipientEmail,
        firstName: lead.first_name || '',
        subject: SUBJECT_BY_TYPE[type],
        downloadUrl,
      }),
    });
    const gasResult = await resp.json().catch(() => ({}));

    if (!gasResult || gasResult.ok !== true) {
      console.error('Apps Script email send failed', gasResult);
      return { statusCode: 502, body: JSON.stringify({ ok: false, error: 'Could not send the email right now.' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('email-asset error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Could not send the email right now.' }) };
  }
};
