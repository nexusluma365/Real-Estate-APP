const { saveLead, getLeadByEmail } = require('./_lib/store');
const { normalizeEmail, isValidEmail } = require('./_lib/email');
const { normalizeManyChatContactId } = require('./_lib/manychat');
const { normalizeAgentLead } = require('./_lib/agent-number-one');

const AGENT_HANDOFF_TIMEOUT_MS = 25000;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function requestOrigin(event) {
  const headers = event.headers || {};
  const host = headers.host || headers.Host;
  if (!host) return '';
  const proto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https';
  return `${proto}://${host}`;
}

async function triggerAgentHandoff(event, leadId) {
  const origin = requestOrigin(event);
  if (!origin) {
    console.warn('[Agent1 Handoff] Skipping submit-lead trigger because request host is unavailable', { leadId });
    return { ok: false, skipped: true, reason: 'missing_host' };
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), AGENT_HANDOFF_TIMEOUT_MS) : null;
  try {
    console.log('[Agent1 Handoff] Triggering from submit-lead', { leadId });
    const res = await fetch(`${origin}/.netlify/functions/agent-handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.ok) {
      console.log('[Agent1 Handoff] submit-lead trigger completed', { leadId, status: res.status });
      const result = {
        ok: true,
        status: res.status,
        mode: data.mode || null,
      };
      if (data.skipped) result.skipped = true;
      if (data.reason) result.reason = data.reason;
      return result;
    }
    console.error('[Agent1 Handoff] submit-lead trigger returned an error', { leadId, status: res.status, body: data });
    return { ok: false, status: res.status, error: data && data.error ? data.error : 'Agent handoff failed.' };
  } catch (err) {
    console.error('[Agent1 Handoff] submit-lead trigger failed', { leadId, error: String(err && err.message ? err.message : err) });
    return { ok: false, error: String(err && err.message ? err.message : err) };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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

  const email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    return json(400, { ok: false, error: 'A valid email address is required.' });
  }

  if (payload.lookupOnly || payload.lookup_only) {
    let lead = null;
    try {
      lead = await getLeadByEmail(email);
    } catch (err) {
      console.error('lead lookup failed', err);
      return json(200, { ok: true, registered: false, error: 'Could not check this email right now.' });
    }
    return json(200, {
      ok: true,
      registered: !!(lead && lead.lead_id),
      lead: lead && lead.lead_id ? lead : undefined,
    });
  }

  const leadId = String(payload.lead_id || payload.leadId || '').trim();
  if (!leadId) {
    return json(400, { ok: false, error: 'lead_id is required.' });
  }
  payload.email = email;
  const manychatContactId = normalizeManyChatContactId(payload.manychat_contact_id || payload.manychatContactId);
  if (manychatContactId) payload.manychat_contact_id = manychatContactId;
  else {
    delete payload.manychat_contact_id;
    delete payload.manychatContactId;
  }
  Object.assign(payload, normalizeAgentLead(payload));

  let saved = false;
  try {
    await saveLead(leadId, { ...payload, lead_id: leadId });
    saved = true;
  } catch (err) {
    console.error('lead save failed', err);
  }

  const agentHandoff = saved
    ? await triggerAgentHandoff(event, leadId)
    : { ok: false, skipped: true, reason: 'lead_not_saved' };

  const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL || '';
  if (!googleScriptUrl) {
    return json(200, {
      ok: saved,
      saved,
      sheetsOk: false,
      agentHandoff,
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
      agentHandoff,
      sheets: data,
      warning: saved && !sheetsOk ? 'Google Sheets did not accept the lead; lead was still saved.' : undefined,
      error: saved || sheetsOk ? undefined : 'Could not save questionnaire.',
    });
  } catch (err) {
    return json(200, {
      ok: saved,
      saved,
      sheetsOk: false,
      agentHandoff,
      warning: saved ? String(err && err.message ? err.message : err) : undefined,
      error: saved ? undefined : 'Could not save questionnaire.',
    });
  }
};
