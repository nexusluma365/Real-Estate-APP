// POST /.netlify/functions/agent-handoff
// Body: { leadId } or { lead: {...} }
//
// Stub for the future N8N handoff. If N8N_AGENT_HANDOFF_WEBHOOK_URL is
// configured, this forwards the clean handoff payload. Otherwise it returns
// the payload without side effects so the next automation can be tested safely.
const { getLead } = require('./_lib/store');
const { buildAgentHandoff } = require('./_lib/agent-number-one');

const LOCAL_VILLAGE_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function allowedOrigins() {
  return new Set([
    ...LOCAL_VILLAGE_ORIGINS,
    ...(process.env.AGENT_HANDOFF_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  ]);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(event),
      body: '',
    };
  }

  try {
    if (event.httpMethod !== 'POST') {
      return json(event, 405, { ok: false, error: 'Method not allowed' }, { Allow: 'POST, OPTIONS' });
    }

    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (_err) {
      return json(event, 400, { ok: false, error: 'Invalid JSON payload.' });
    }

    const leadId = String(body.leadId || body.lead_id || '').trim();
    let lead = body.lead && typeof body.lead === 'object' ? body.lead : null;
    if (!lead && leadId) lead = await getLead(leadId);
    if (!lead) return json(event, 404, { ok: false, error: 'No saved Agent Number One lead was found.' });

    const handoff = buildAgentHandoff({ ...lead, lead_id: lead.lead_id || leadId });
    const webhookUrl = process.env.N8N_AGENT_HANDOFF_WEBHOOK_URL || '';
    if (!webhookUrl) {
      return json(event, 200, { ok: true, mode: 'stub', webhookConfigured: false, handoff });
    }

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(handoff),
      });
      const text = await res.text().catch(() => '');
      return json(event, 200, {
        ok: res.ok,
        mode: 'forwarded',
        webhookConfigured: true,
        n8nStatus: res.status,
        n8nBody: text.slice(0, 1000),
        handoff,
      });
    } catch (err) {
      return json(event, 502, {
        ok: false,
        mode: 'forward_failed',
        webhookConfigured: true,
        error: String(err && err.message ? err.message : err),
        handoff,
      });
    }
  } catch (err) {
    return json(event, 500, {
      ok: false,
      error: 'Unexpected Agent handoff error.',
      detail: String(err && err.message ? err.message : err),
    });
  }
};

function corsHeaders(event) {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const headers = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };

  if (allowedOrigins().has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function json(event, statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(event), ...headers },
    body: JSON.stringify(body),
  };
}
