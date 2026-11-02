import { body, fail, getSession, json, notConfigured, type Ctx } from '../_lib';

/**
 * POST /api/match { place, move, budget, beds, hurdles[] } — records a finished apartment-match questionnaire as one row
 * in the owner's Google Sheet (via the Apps Script web app in google-sheets/). Needs the visitor's lead session, so the
 * row carries the name and email they just gave. Only known answer values are accepted; they're stored as plain labels.
 *
 * Answers go to the Sheet only — never to analytics, ad platforms or the ESP. Identical answers from the same person on
 * the same day are written once, and each person is capped at DAILY_CAP rows a day.
 */
const LABELS = {
  move: { asap: 'As soon as possible', '30': 'Within 30 days', '90': 'Within 1–3 months', exploring: 'Just exploring' },
  budget: { u1000: 'Under $1,000', '1000': '$1,000–$1,500', '1500': '$1,500–$2,000', '2000': '$2,000+' },
  beds: { studio: 'Studio', '1': '1 Bedroom', '2': '2 Bedrooms', '3': '3+ Bedrooms' },
  hurdles: {
    credit: 'Credit concerns', eviction: 'Past eviction', lease: 'Broken lease', collections: 'Collections or debt',
    income: 'Income or job changes', none: 'None of these', prefer: 'Prefer not to say',
  },
} as const;
const DAILY_CAP = 20;

type In = { place?: unknown; move?: unknown; budget?: unknown; beds?: unknown; hurdles?: unknown };
const pick = <K extends keyof typeof LABELS>(k: K, v: unknown) =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(LABELS[k], v) ? (LABELS[k] as Record<string, string>)[v] : null;
/** Spreadsheet apps run cells that start with = + - @ as formulas; prefix those with ' so they stay text. */
export const cell = (v: unknown) => {
  const s = String(v ?? '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, 200);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
};

export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.SESSION_SECRET) return notConfigured('Questionnaire recording');
  const s = await getSession(request, env);
  if (!s) return fail(401, 'Your session expired. Please enter your email again.', 'no_session');
  const b = await body<In>(request).catch(() => null);
  if (!b) return fail(400, 'Invalid request.');

  const place = typeof b.place === 'string' ? b.place.replace(/[<>]/g, '').trim().slice(0, 120) : '';
  const move = pick('move', b.move), budget = pick('budget', b.budget), beds = pick('beds', b.beds);
  const hurdles = Array.isArray(b.hurdles) ? [...new Set(b.hurdles.map((h) => pick('hurdles', h)).filter((h): h is string => !!h))] : [];
  if (place.length < 2 || !move || !budget || !beds || !hurdles.length) return fail(422, 'Some answers are missing.', 'validation');

  if (!env.GOOGLE_SHEETS_WEBHOOK_URL || !env.GOOGLE_SHEETS_WEBHOOK_SECRET) return json({ recorded: false, reason: 'not_configured' }, 202);

  // Once per identical set of answers per day, and a daily cap — stored as a bare fact (no answers) in the lifecycle log.
  const day = new Date().toISOString().slice(0, 10);
  const today = await env.DB.prepare("SELECT COUNT(*) AS n FROM rr_lifecycle_events WHERE lead_id = ? AND event = 'match_recorded' AND ref LIKE ?")
    .bind(s.lead_id, `${day}:%`).first<{ n: number }>();
  if (Number(today?.n ?? 0) >= DAILY_CAP) return json({ recorded: false, reason: 'daily_cap' }, 429);
  const key = await digest([place.toLowerCase(), move, budget, beds, hurdles.join('|')].join('\n'));
  const fresh = (await env.DB.prepare('INSERT INTO rr_lifecycle_events (lead_id, event, ref, data, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(s.lead_id, 'match_recorded', `${day}:${key}`, '{}', new Date().toISOString()).run()) as { meta?: { changes?: number } };
  if (fresh?.meta?.changes === 0) return json({ recorded: true, duplicate: true });

  const lead = await env.DB.prepare('SELECT email, first_name, email_consent, utm_source, utm_medium, utm_campaign, gclid FROM rr_leads WHERE lead_id = ?')
    .bind(s.lead_id).first<{ email: string; first_name: string; email_consent: number; utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; gclid: string | null }>();
  const row = {
    submitted_at: new Date().toISOString(),
    first_name: cell(lead?.first_name), email: cell(lead?.email), marketing_opt_in: lead?.email_consent ? 'Yes' : 'No',
    location: cell(place), move_timing: move, budget, bedrooms: beds, rental_concerns: hurdles.join(', '),
    premium_member: s.customer_id ? 'Customer' : '', lead_id: s.lead_id,
    utm_source: cell(lead?.utm_source), utm_medium: cell(lead?.utm_medium), utm_campaign: cell(lead?.utm_campaign), gclid: lead?.gclid ? 'Yes' : '',
  };
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    const r = await fetch(env.GOOGLE_SHEETS_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: env.GOOGLE_SHEETS_WEBHOOK_SECRET, row }), signal: ctl.signal,
    }).finally(() => clearTimeout(t));
    const out = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!r.ok || !out?.ok) throw new Error(`Sheet webhook ${r.status}: ${out?.error || 'no ok in response'}`);
  } catch (e) {
    // Let the visitor retry this exact submission later (and not count it toward the cap).
    await env.DB.prepare("DELETE FROM rr_lifecycle_events WHERE lead_id = ? AND event = 'match_recorded' AND ref = ?").bind(s.lead_id, `${day}:${key}`).run();
    console.error('questionnaire → sheet failed', e);
    return json({ recorded: false, reason: 'sheet_error' }, 502);
  }
  return json({ recorded: true });
};

async function digest(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
