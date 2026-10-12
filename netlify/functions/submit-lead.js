const { saveLead, getLead, getLeadByEmail } = require('./_lib/store');
const { readSession, sessionForLead, sessionCookie } = require('./_lib/session');
const { sanitizeLeadAnswers } = require('./_lib/lead-fields');
const { normalizeEmail, isValidEmail } = require('./_lib/email');
const { normalizeManyChatContactId } = require('./_lib/manychat');
const { normalizeAgentLead } = require('./_lib/agent-number-one');

const AGENT_HANDOFF_TIMEOUT_MS = 25000;

// The email lookup is unauthenticated (anyone can type any email). An email
// address is not proof of identity, so the summary below (which includes the
// lead_id) is only returned to the browser whose rr_session cookie already
// belongs to that lead; everyone else gets registered:false and continues the
// questionnaire. Even the owner never gets phone, income, credit range, last
// name, or agent/activity history.
const PUBLIC_LOOKUP_FIELDS = [
  'lead_id',
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

function publicLeadSummary(lead) {
  const summary = {};
  PUBLIC_LOOKUP_FIELDS.forEach((field) => {
    if (lead[field] !== undefined && lead[field] !== null && lead[field] !== '') summary[field] = lead[field];
  });
  return summary;
}

function json(statusCode, body, cookie) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
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
    const session = readSession(event);
    const owned = !!(lead && lead.lead_id && session && session.leadId === lead.lead_id);
    return json(200, {
      ok: true,
      registered: owned,
      lead: owned ? publicLeadSummary(lead) : undefined,
    });
  }

  const leadId = String(payload.lead_id || payload.leadId || '').trim();
  if (!leadId) {
    return json(400, { ok: false, error: 'lead_id is required.' });
  }
  payload = sanitizeLeadAnswers(payload);
  payload.email = email;
  const manychatContactId = normalizeManyChatContactId(payload.manychat_contact_id || payload.manychatContactId);
  if (manychatContactId) payload.manychat_contact_id = manychatContactId;
  else {
    delete payload.manychat_contact_id;
    delete payload.manychatContactId;
  }
  Object.assign(payload, normalizeAgentLead(payload));

  // Only the browser that created a lead may overwrite it. A request that
  // merely knows someone's lead_id can't change their email or answers.
  let existingLead = null;
  try {
    existingLead = await getLead(leadId);
  } catch (err) {
    console.error('lead ownership lookup failed', err && err.message);
    return json(200, { ok: false, saved: false, sheetsOk: false, error: 'Could not save questionnaire.' });
  }
  if (existingLead && !sessionForLead(event, leadId)) {
    console.warn('submit-lead refused overwrite of existing lead without session', { leadId });
    return json(200, { ok: true, saved: false, sheetsOk: false, reason: 'lead_exists' });
  }
  const cookie = existingLead ? null : sessionCookie({ leadId });

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
    }, saved ? cookie : null);
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
    }, saved ? cookie : null);
  } catch (err) {
    return json(200, {
      ok: saved,
      saved,
      sheetsOk: false,
      agentHandoff,
      warning: saved ? String(err && err.message ? err.message : err) : undefined,
      error: saved ? undefined : 'Could not save questionnaire.',
    }, saved ? cookie : null);
  }
};
