// POST /.netlify/functions/track-event
// Body: { event, visitor_id, lead_id?, page?, step?, detail? }
//
// Browser-side funnel steps (page views, questionnaire questions, checkout
// clicks, upsell decisions) are forwarded to the Google Sheets tracker.
// Only the step names below are accepted from the browser — payment
// results are logged by the server from Stripe (see _lib/funnel.js), so a
// visitor can't mark themselves "paid" in the sheet.
const CLIENT_EVENTS = new Set([
  'page_view',
  'intent_landing_view',
  'intent_cta_click',
  'questionnaire_started',
  'questionnaire_step',
  'questionnaire_completed',
  'results_processing_viewed',
  'checkout_viewed',
  'checkout_submitted',
  'checkout_payment_failed',
  'results_viewed',
  'upsell_viewed',
  'upsell_clicked',
  'upsell_declined',
  'upsell_failed',
  'listing_preview_viewed',
  'full_listings_viewed',
  'unlock_listings_clicked',
  'property_contact_clicked',
]);

const MAX_FIELD = 300;

function clip(value) {
  return String(value === undefined || value === null ? '' : value).slice(0, MAX_FIELD);
}

function cleanDetail(detail) {
  if (!detail || typeof detail !== 'object') return {};
  const out = {};
  Object.keys(detail).slice(0, 20).forEach((key) => {
    const value = detail[key];
    if (value === undefined || value === null || typeof value === 'object') return;
    out[clip(key).slice(0, 60)] = clip(value);
  });
  return out;
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body) : {};
  } catch (_err) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON payload.' }) };
  }

  const name = clip(payload.event);
  const visitorId = clip(payload.visitor_id);
  if (!CLIENT_EVENTS.has(name) || !visitorId) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Unknown event.' }) };
  }

  const url = process.env.GOOGLE_SCRIPT_URL || '';
  if (!url || url.includes('PASTE_YOUR')) {
    return { statusCode: 200, body: JSON.stringify({ ok: false, skipped: true }) };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'trackEvent',
        source: 'client',
        event: name,
        visitor_id: visitorId,
        lead_id: clip(payload.lead_id),
        step: clip(payload.step),
        page: clip(payload.page),
        occurred_at: clip(payload.occurred_at) || new Date().toISOString(),
        detail: cleanDetail(payload.detail),
        user_agent: clip((event.headers || {})['user-agent']),
      }),
    });
    return { statusCode: 200, body: JSON.stringify({ ok: res.ok }) };
  } catch (err) {
    console.warn('[track-event] forward failed', String(err && err.message ? err.message : err));
    return { statusCode: 200, body: JSON.stringify({ ok: false }) };
  }
};
