const { saveLead } = require('./_lib/store');
const { normalizeEmail, isValidEmail } = require('./_lib/email');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { Allow: 'POST' }, body: JSON.stringify({ ok: false, error: 'Method not allowed' }) };
  }

  let payload = {};
  try {
    payload = event.body ? JSON.parse(event.body) : {};
  } catch (_err) {
    return json(400, { ok: false, error: 'Invalid JSON payload.' });
  }

  const leadId = String(payload.lead_id || payload.leadId || '').trim();
  if (!leadId) {
    return json(400, { ok: false, error: 'lead_id is required.' });
  }
  const email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    return json(400, { ok: false, error: 'A valid email address is required.' });
  }
  payload.email = email;

  let saved = false;
  try {
    await saveLead(leadId, { ...payload, lead_id: leadId });
    saved = true;
  } catch (err) {
    console.error('lead save failed', err);
  }

  const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL || '';
  if (!googleScriptUrl) {
    return json(200, {
      ok: saved,
      saved,
      sheetsOk: false,
      warning: saved ? 'GOOGLE_SCRIPT_URL is not configured; lead was saved without Google Sheets forwarding.' : undefined,
      error: saved ? undefined : 'Could not save questionnaire.',
    });
  }

  try {
    const res = await fetch(googleScriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch (_err) { data = { ok: res.ok, raw: text }; }

    const sheetsOk = !!(res.ok && data && data.ok !== false);
    return json(200, {
      ok: saved || sheetsOk,
      saved,
      sheetsOk,
      sheets: data,
      warning: saved && !sheetsOk ? 'Google Sheets did not accept the lead; lead was still saved.' : undefined,
      error: saved || sheetsOk ? undefined : 'Could not save questionnaire.',
    });
  } catch (err) {
    return json(200, {
      ok: saved,
      saved,
      sheetsOk: false,
      warning: saved ? String(err && err.message ? err.message : err) : undefined,
      error: saved ? undefined : 'Could not save questionnaire.',
    });
  }
};
