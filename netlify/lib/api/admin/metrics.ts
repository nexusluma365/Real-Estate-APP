import { bearerOk, fail, json, notConfigured, type Ctx } from '../../_lib';

/**
 * GET /api/admin/metrics?days=30 — aggregate funnel numbers for /admin (Authorization: Bearer ADMIN_TOKEN).
 * Returns counts and sums only — never names, emails or quiz answers.
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.ADMIN_TOKEN) return notConfigured('Admin metrics');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const DB = env.DB;
  const one = async (q: string, ...v: unknown[]) => ((await DB.prepare(q).bind(...v).first<{ n: number }>())?.n ?? 0);
  const ev = (name: string) => one('SELECT COUNT(DISTINCT session_id) AS n FROM rr_events WHERE event = ? AND at >= ?', name, since);

  const [visitors, qualStarted, qualCompleted, productViews, checkoutViews, checkoutStarts, leads, abandoned] = await Promise.all([
    ev('landing_view'), ev('qualification_started'), ev('qualification_completed'), ev('product_view'), ev('checkout_view'),
    one("SELECT COUNT(DISTINCT lead_id) AS n FROM rr_lifecycle_events WHERE event = 'checkout_started' AND at >= ?", since),
    one('SELECT COUNT(*) AS n FROM rr_leads WHERE created_at >= ?', since),
    one("SELECT COUNT(*) AS n FROM rr_lifecycle_events WHERE event = 'checkout_abandoned' AND at >= ?", since),
  ]);
  const recovered = await one(
    `SELECT COUNT(DISTINCT a.lead_id) AS n FROM rr_lifecycle_events a JOIN rr_orders o ON o.lead_id = a.lead_id AND o.created_at > a.at
      WHERE a.event = 'checkout_abandoned' AND a.at >= ?`, since);
  const tiers = (await DB.prepare('SELECT intent_tier AS k, COUNT(*) AS n FROM rr_leads WHERE created_at >= ? GROUP BY intent_tier').bind(since).all<{ k: string | null; n: number }>()).results;
  const products = (await DB.prepare(
    'SELECT product AS k, COUNT(*) AS n, SUM(amount_cents) AS gross, SUM(COALESCE(refunded_cents, 0)) AS refunded, SUM(CASE WHEN refunded_at IS NOT NULL THEN 1 ELSE 0 END) AS refunds FROM rr_orders WHERE created_at >= ? GROUP BY product',
  ).bind(since).all<{ k: string; n: number; gross: number; refunded: number; refunds: number }>()).results;
  const bySource = (await DB.prepare(
    `SELECT COALESCE(l.utm_source, '(direct / none)') AS k, COUNT(DISTINCT o.customer_id) AS customers, SUM(o.amount_cents - COALESCE(o.refunded_cents, 0)) AS net
       FROM rr_orders o LEFT JOIN rr_leads l ON l.lead_id = o.lead_id WHERE o.created_at >= ? GROUP BY k ORDER BY net DESC LIMIT 20`,
  ).bind(since).all<{ k: string; customers: number; net: number }>()).results;
  const leadsBySource = (await DB.prepare(`SELECT COALESCE(utm_source, '(direct / none)') AS k, COUNT(*) AS n FROM rr_leads WHERE created_at >= ? GROUP BY k`).bind(since).all<{ k: string; n: number }>()).results;

  return json({ source: 'live', days, visitors, leads, qualStarted, qualCompleted, productViews, checkoutViews, checkoutStarts, abandoned, recovered, tiers, products, bySource, leadsBySource });
};
