import { json, type Ctx } from '../_lib';

/**
 * POST /api/events — first-party analytics beacon (sendBeacon). Stored for the /admin funnel dashboard.
 * Only allow-listed, non-personal fields are kept (the client already strips everything else).
 * INTEGRATE (optional): also forward to GA4 Measurement Protocol / a warehouse.
 */
const EVENT_RE = /^[a-z_]{3,40}$/;
const s = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : null);

export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.DB) return json({ ok: true }, 202);
  const text = await request.text();
  if (text.length > 4000) return json({ ok: false }, 413);
  let p: Record<string, unknown>;
  try {
    p = JSON.parse(text);
  } catch {
    return json({ ok: false }, 400);
  }
  if (typeof p.event !== 'string' || !EVENT_RE.test(p.event)) return json({ ok: false }, 400);
  const value = typeof p.revenue === 'number' ? p.revenue : typeof p.order_value === 'number' ? p.order_value : null;
  await env.DB.prepare(
    'INSERT INTO rr_events (event, session_id, lead_id, product, value, cta_location, intent_tier, utm_source, utm_campaign, landing_intent, page_path, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  ).bind(p.event, s(p.session_id, 80), s(p.lead_id, 80), s(p.product, 20), value, s(p.cta_location, 40), s(p.intent_tier, 10), s(p.utm_source, 100), s(p.utm_campaign, 100), s(p.landing_intent, 80), s(p.page_path, 200), new Date().toISOString()).run();
  return json({ ok: true }, 202);
};
