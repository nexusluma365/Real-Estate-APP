import { body, fail, json, notConfigured, setSession, type Ctx } from '../_lib';

const TIERS = new Set(['high', 'medium', 'early']);
const RECS = new Set(['creditready', 'guide', 'checklist']);
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[<>]/g, '').trim().slice(0, n) : null) || null;

/**
 * POST /api/leads — every opt-in point (start, checkout, free checklist). Upserts by email (progressive profiling:
 * later answers fill in, never wipe, earlier ones). Marketing consent is stored separately from the record itself.
 */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.SESSION_SECRET || !env.DB) return notConfigured('Lead capture');
  type In = {
    first_name?: string; email?: string; email_consent?: boolean; consent_basis?: string; consent_text?: string;
    lead_source?: string; product_interest?: string; session_id?: string; attribution?: Record<string, string>; turnstile_token?: string;
    qualification?: { stage?: string; concern?: string; help?: string; intent_tier?: string; recommended?: string };
  };
  const b = await body<In>(request).catch(() => null);
  if (!b) return fail(400, 'Invalid request.');
  const first = String(b.first_name || '').replace(/[<>]/g, '').trim().slice(0, 40);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
  const emailOnlyExit = b.lead_source === 'exit' && first.length === 0;
  if ((!emailOnlyExit && first.length < 2) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(422, 'Check your name and email.', 'validation');

  if (env.TURNSTILE_SECRET_KEY) {
    const form = new FormData();
    form.append('secret', env.TURNSTILE_SECRET_KEY);
    form.append('response', b.turnstile_token || '');
    form.append('remoteip', request.headers.get('CF-Connecting-IP') || '');
    const v = (await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })).json()) as { success: boolean };
    if (!v.success) return fail(403, 'Please complete the verification and try again.', 'bot_check');
  }

  const existing = await env.DB.prepare('SELECT lead_id FROM rr_leads WHERE email = ?').bind(email).first<{ lead_id: string }>();
  const lead_id = existing?.lead_id || `lead_${crypto.randomUUID().replace(/-/g, '')}`;
  const a = b.attribution || {};
  const q = b.qualification || {};
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO rr_leads (lead_id, email, first_name, email_consent, consent_basis, consent_text, consent_at, session_id,
       utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, landing_intent, landing_path,
       lead_source, product_interest, qual_stage, qual_concern, qual_help, intent_tier, recommended_product, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(email) DO UPDATE SET
       first_name = CASE WHEN excluded.first_name <> '' THEN excluded.first_name ELSE rr_leads.first_name END,
       gclid = COALESCE(excluded.gclid, rr_leads.gclid),
       email_consent = CASE WHEN rr_leads.email_consent > excluded.email_consent THEN rr_leads.email_consent ELSE excluded.email_consent END,
       consent_basis = CASE WHEN excluded.email_consent = 1 THEN excluded.consent_basis ELSE rr_leads.consent_basis END,
       consent_text = CASE WHEN excluded.email_consent = 1 THEN excluded.consent_text ELSE rr_leads.consent_text END,
       consent_at = CASE WHEN excluded.email_consent = 1 AND rr_leads.email_consent = 0 THEN excluded.consent_at ELSE rr_leads.consent_at END,
       product_interest = COALESCE(excluded.product_interest, rr_leads.product_interest),
       qual_stage = COALESCE(excluded.qual_stage, rr_leads.qual_stage),
       qual_concern = COALESCE(excluded.qual_concern, rr_leads.qual_concern),
       qual_help = COALESCE(excluded.qual_help, rr_leads.qual_help),
       intent_tier = COALESCE(excluded.intent_tier, rr_leads.intent_tier),
       recommended_product = COALESCE(excluded.recommended_product, rr_leads.recommended_product),
       updated_at = excluded.updated_at`,
  ).bind(
    lead_id, email, first, b.email_consent ? 1 : 0, clip(b.consent_basis, 20), clip(b.consent_text, 300), b.email_consent ? now : null, clip(b.session_id, 80),
    clip(a.utm_source, 200), clip(a.utm_medium, 200), clip(a.utm_campaign, 200), clip(a.utm_term, 200), clip(a.utm_content, 200), clip(a.gclid, 200), clip(a.landing_intent, 80), clip(a.landing_path, 200),
    clip(b.lead_source, 20), clip(b.product_interest, 20), clip(q.stage, 20), clip(q.concern, 20), clip(q.help, 20),
    TIERS.has(String(q.intent_tier)) ? q.intent_tier : null, RECS.has(String(q.recommended)) ? q.recommended : null, now, now,
  ).run();

  return json({ lead_id }, 200, { 'Set-Cookie': await setSession(env, { lead_id }) });
};
