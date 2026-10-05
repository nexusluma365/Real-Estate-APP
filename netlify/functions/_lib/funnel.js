// Server-side funnel events for the Google Sheets tracker (Apps Script
// `trackEvent` action). Only the server reports money events — trial
// started, subscription paid/failed/canceled, upsell paid — because those
// come from Stripe and must not be spoofable from the browser.
//
// Never throws and never blocks a payment for long: a slow or missing sheet
// just means one missed row, not a failed checkout.
const TIMEOUT_MS = 4000;

async function logFunnelEvent(event, fields = {}) {
  const url = process.env.GOOGLE_SCRIPT_URL || '';
  if (!url || url.includes('PASTE_YOUR') || !fields.lead_id) return false;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'trackEvent',
        source: 'server',
        event,
        occurred_at: new Date().toISOString(),
        ...fields,
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    return res.ok;
  } catch (err) {
    console.warn('[funnel] could not log event', event, String(err && err.message ? err.message : err));
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

module.exports = { logFunnelEvent };
