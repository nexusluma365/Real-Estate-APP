import { body, getSession, json, notConfigured, recordLifecycle, type Ctx } from '../_lib';

/**
 * Facts the browser may report. Purchases, payment failures, refunds and abandonment are server-only
 * (Stripe webhook + /api/cron/abandoned) and are rejected here.
 */
const ALLOWED = new Set([
  'lead_captured', 'qualification_completed', 'free_resource_requested', 'checkout_started', 'upsell_declined', 'upsell_failed',
  'assessment_started', 'assessment_incomplete', 'assessment_complete', 'product_accessed', 'gameplan_completed', 'search_saved',
]);
/** Events that should only ever be recorded once per lead (ref ''). Others get a per-day ref so repeats are bounded. */
const ONCE = new Set(['lead_captured', 'qualification_completed', 'free_resource_requested', 'upsell_declined', 'assessment_complete', 'gameplan_completed']);
/** `place` is the apartment-match search area (a city or ZIP) — never rental history, credit or income answers. */
const SAFE_DATA = ['product', 'value', 'source', 'resource', 'reason', 'intent_tier', 'recommended', 'place'];

/** POST /api/lifecycle — records the fact and forwards it to the ESP (see _lib.recordLifecycle). */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.SESSION_SECRET) return notConfigured('Lifecycle events');
  const s = await getSession(request, env);
  const b = await body<{ event?: string; data?: Record<string, unknown> }>(request).catch(() => ({}) as { event?: string; data?: Record<string, unknown> });
  if (!s || !b.event || !ALLOWED.has(b.event)) return json({ ok: false }, 400);
  if (b.event === 'search_saved' && (typeof b.data?.place !== 'string' || !b.data.place.trim())) return json({ ok: false }, 400);
  const data = Object.fromEntries(Object.entries(b.data || {}).filter(([k, v]) => SAFE_DATA.includes(k) && ['string', 'number', 'boolean'].includes(typeof v)).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 60) : v]));
  const day = new Date().toISOString().slice(0, 10);
  // search_saved emails the search link: once per place per day, so a refresh or double-click never sends a second one.
  const ref = ONCE.has(b.event) ? '' : b.event === 'checkout_started' ? `${data.product || ''}:${new Date().toISOString().slice(0, 13)}` : b.event === 'search_saved' ? `${String(data.place || '').toLowerCase()}:${day}` : day;
  const created = await recordLifecycle(env, s.lead_id, b.event, data, ref);
  return json({ ok: true, duplicate: !created });
};
