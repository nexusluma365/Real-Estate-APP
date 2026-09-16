// POST /.netlify/functions/agent-handoff
// Body: { leadId } or { lead: {...} }
//
// Stub for the future N8N handoff. If N8N_AGENT_HANDOFF_WEBHOOK_URL is
// configured, this forwards the clean handoff payload. Otherwise it returns
// the payload without side effects so the next automation can be tested safely.
const { getLead } = require('./_lib/store');
const { buildAgentHandoff } = require('./_lib/agent-number-one');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' }, { Allow: 'POST' });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (_err) {
    return json(400, { ok: false, error: 'Invalid JSON payload.' });
  }

  const leadId = String(body.leadId || body.lead_id || '').trim();
  let lead = body.lead && typeof body.lead === 'object' ? body.lead : null;
  if (!lead && leadId) lead = await getLead(leadId);
  if (!lead) return json(404, { ok: false, error: 'No saved Agent Number One lead was found.' });

  const handoff = buildAgentHandoff({ ...lead, lead_id: lead.lead_id || leadId });
  const webhookUrl = process.env.N8N_AGENT_HANDOFF_WEBHOOK_URL || '';
  if (!webhookUrl) {
    return json(200, { ok: true, mode: 'stub', webhookConfigured: false, handoff });
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(handoff),
    });
    const text = await res.text().catch(() => '');
    return json(200, {
      ok: res.ok,
      mode: 'forwarded',
      webhookConfigured: true,
      n8nStatus: res.status,
      n8nBody: text.slice(0, 1000),
      handoff,
    });
  } catch (err) {
    return json(502, {
      ok: false,
      mode: 'forward_failed',
      webhookConfigured: true,
      error: String(err && err.message ? err.message : err),
      handoff,
    });
  }
};

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}
