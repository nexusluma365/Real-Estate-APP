const store = require('./_lib/store');
const { sign } = require('./_lib/sign');
const { sessionOwnsLead, issueSessionCookie, withCookie } = require('./_lib/session');
const { normalizeEmail, isValidEmail } = require('./_lib/email');
const { normalizeManyChatContactId } = require('./_lib/manychat');
const { normalizeAgentLead } = require('./_lib/agent-number-one');

const AGENT_HANDOFF_TIMEOUT_MS = 25000;

const PREVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

// The email lookup is unauthenticated (anyone can type any email), so it only
// returns the fields the returning-renter listing redirect actually uses —
// never phone, income, credit range, last name, or agent/activity history.
// It also never returns the lead_id: a lead_id used to be enough to charge the
// card saved on that profile. Instead the caller gets a short-lived,
// preview-only token (see get-apartment-results / return-access). The browser
// that already owns the lead (it holds that lead's signed session cookie) is
// the only caller that gets the lead_id back.
const PUBLIC_LOOKUP_FIELDS = [
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
      lead = await store.getLeadByEmail(email);
    } catch (err) {
      console.error('lead lookup failed', err);
      return json(200, { ok: true, registered: false, error: 'Could not check this email right now.' });
    }
    if (!lead || !lead.lead_id) {
      return json(200, { ok: true, registered: false });
    }
    const summary = publicLeadSummary(lead);
    if (sessionOwnsLead(event, lead.lead_id)) {
      summary.lead_id = lead.lead_id;
    } else {
      try {
        summary.preview_token = sign({ product: 'apartment-results-preview', leadId: lead.lead_id }, PREVIEW_TOKEN_TTL_MS);
      } catch (err) {
        console.error('preview token sign failed', err.message);
      }
    }
    return json(200, { ok: true, registered: true, lead: summary });
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

  // Never let an unauthenticated request overwrite a lead that already
  // exists. New leads get a fresh random id from the questionnaire; only the
  // browser that created a lead (it holds the signed session cookie) may
  // update it later.
  let existingLead = null;
  try {
    existingLead = typeof store.getLead === 'function' ? await store.getLead(leadId) : null;
  } catch (err) {
    console.error('existing lead lookup failed', err);
    return json(503, { ok: false, error: 'Could not save questionnaire right now. Please try again.' });
  }
  if (existingLead && !sessionOwnsLead(event, leadId)) {
    return json(403, {
      ok: false,
      code: 'lead_exists',
      error: 'This profile already exists. Open the secure link in your RentReady email to update it.',
    });
  }

  let saved = false;
  try {
    await store.saveLead(leadId, { ...payload, lead_id: leadId });
    saved = true;
  } catch (err) {
    console.error('lead save failed', err);
  }

  let sessionCookie = null;
  if (saved) {
    try {
      sessionCookie = issueSessionCookie(event, leadId, 'lead');
      if (!existingLead && typeof store.patchEntitlements === 'function') {
        await store.patchEntitlements(leadId, { sessionClaimedAt: new Date().toISOString() });
      }
    } catch (err) {
      console.error('lead session issue failed', err.message || err);
    }
  }
  const respond = (statusCode, body) => withCookie(json(statusCode, body), sessionCookie);

  const agentHandoff = saved
    ? await triggerAgentHandoff(event, leadId)
    : { ok: false, skipped: true, reason: 'lead_not_saved' };

  const googleScriptUrl = process.env.GOOGLE_SCRIPT_URL || '';
  if (!googleScriptUrl) {
    return respond(200, {
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
    return respond(200, {
      ok: saved || sheetsOk,
      saved,
      sheetsOk,
      agentHandoff,
      sheets: data,
      warning: saved && !sheetsOk ? 'Google Sheets did not accept the lead; lead was still saved.' : undefined,
      error: saved || sheetsOk ? undefined : 'Could not save questionnaire.',
    });
  } catch (err) {
    return respond(200, {
      ok: saved,
      saved,
      sheetsOk: false,
      agentHandoff,
      warning: saved ? String(err && err.message ? err.message : err) : undefined,
      error: saved ? undefined : 'Could not save questionnaire.',
    });
  }
};
