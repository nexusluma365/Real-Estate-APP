// POST /.netlify/functions/agent-handoff
// Body: { leadId } or { lead: {...} }
//
// If N8N_AGENT_HANDOFF_WEBHOOK_URL is configured, this forwards the saved
// lead UUID to Agent 1. Otherwise it returns the handoff payload without side
// effects so local/test flows can be exercised safely.
const {
  getLead,
  claimAgentHandoff,
  markAgentHandoffComplete,
  markAgentHandoffFailed,
} = require('./_lib/store');
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
  console.log('[Agent1 Handoff] Starting handoff');
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
    console.log('[Agent1 Handoff] Lead ID received', { hasLeadId: !!leadId });
    let lead = body.lead && typeof body.lead === 'object' ? body.lead : null;
    if (!lead && leadId) lead = await getLead(leadId);
    if (!lead) return json(event, 404, { ok: false, error: 'No saved Agent Number One lead was found.' });

    const webhookUrl = process.env.N8N_AGENT_HANDOFF_WEBHOOK_URL || '';
    if (!webhookUrl) {
      const handoff = buildAgentHandoff({ ...lead, lead_id: lead.lead_id || leadId });
      console.log('[Agent1 Handoff] Webhook not configured; returning stub payload');
      return json(event, 200, { ok: true, mode: 'stub', webhookConfigured: false, handoff });
    }

    if (leadId && typeof claimAgentHandoff === 'function') {
      const claim = await claimAgentHandoff(leadId);
      if (!claim || !claim.claimed) {
        const skippedLead = (claim && claim.lead) || lead;
        const handoff = buildAgentHandoff({ ...skippedLead, lead_id: skippedLead.lead_id || leadId });
        const reason = (claim && claim.reason) || 'agent_1_handoff_not_claimed';
        console.log('[Agent1 Handoff] Skipping duplicate handoff', { leadId, reason });
        return json(event, 200, {
          ok: true,
          skipped: true,
          reason,
          mode: 'skipped',
          webhookConfigured: true,
          handoff,
        });
      }
      lead = claim.lead || lead;
    }

    const handoff = buildAgentHandoff({ ...lead, lead_id: lead.lead_id || leadId });
    const actualLeadId = handoff.lead_id;
    try {
      console.log('[Agent1 Handoff] Forwarding to n8n', { leadId: actualLeadId });
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: actualLeadId }),
      });
      const text = await res.text().catch(() => '');
      if (res.ok) {
        console.log('[Agent1 Handoff] n8n responded successfully', { status: res.status });
        if (actualLeadId && typeof markAgentHandoffComplete === 'function') {
          await markAgentHandoffComplete(actualLeadId);
        }
      } else {
        console.error('[Agent1 Handoff] n8n returned a non-success response', { status: res.status });
        if (actualLeadId && typeof markAgentHandoffFailed === 'function') {
          await markAgentHandoffFailed(actualLeadId, `n8n returned ${res.status}: ${text.slice(0, 500)}`);
        }
      }
      return json(event, 200, {
        ok: res.ok,
        mode: 'forwarded',
        webhookConfigured: true,
        n8nStatus: res.status,
        n8nBody: text.slice(0, 1000),
        handoff,
      });
    } catch (err) {
      console.error('[Agent1 Handoff] Handoff failed', err);
      if (actualLeadId && typeof markAgentHandoffFailed === 'function') {
        await markAgentHandoffFailed(actualLeadId, String(err && err.message ? err.message : err));
      }
      return json(event, 502, {
        ok: false,
        mode: 'forward_failed',
        webhookConfigured: true,
        error: String(err && err.message ? err.message : err),
        handoff,
      });
    }
  } catch (err) {
    console.error('[Agent1 Handoff] Unexpected handoff error', err);
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
