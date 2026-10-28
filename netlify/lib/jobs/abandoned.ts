import { recordLifecycle, type Env } from '../_lib';

/**
 * Abandoned-checkout detector — run every 15 minutes by the Netlify Scheduled Function
 * netlify/functions/abandoned-checkouts.mts (no public endpoint, so no token to leak).
 * Flags a lead as checkout_abandoned when they reached the payment form ≥ 60 minutes ago (within the last
 * 7 days), have no order since, and haven't already been flagged for that checkout. The ESP then runs the
 * 1h / 24h / 72h / 6d recovery flow and exits it on purchase_completed.
 */
export async function detectAbandonedCheckouts(env: Env): Promise<{ checked: number; flagged: number }> {
  if (!env.DB) throw new Error('Database is not configured (TURSO_DATABASE_URL).');
  const now = Date.now();
  const olderThan = new Date(now - 60 * 60 * 1000).toISOString();
  const newerThan = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT e.lead_id AS lead_id, MAX(e.at) AS started
       FROM lifecycle_events e
      WHERE e.event = 'checkout_started' AND e.at > ?
      GROUP BY e.lead_id
     HAVING MAX(e.at) < ?
      LIMIT 200`,
  ).bind(newerThan, olderThan).all<{ lead_id: string; started: string }>();

  let flagged = 0;
  for (const r of rows.results) {
    const bought = await env.DB.prepare('SELECT 1 FROM orders WHERE lead_id = ? AND created_at >= ? LIMIT 1').bind(r.lead_id, r.started).first()
      || await env.DB.prepare("SELECT 1 FROM lifecycle_events WHERE lead_id = ? AND event = 'purchase_completed' AND at >= ? LIMIT 1").bind(r.lead_id, r.started).first();
    if (bought) continue;
    const last = await env.DB.prepare("SELECT data FROM lifecycle_events WHERE lead_id = ? AND event = 'checkout_started' AND at = ?").bind(r.lead_id, r.started).first<{ data: string }>();
    let product = 'creditready';
    try { product = (JSON.parse(last?.data || '{}') as { product?: string }).product || product; } catch { /* keep default */ }
    // ref = the checkout's start time, so one checkout is flagged once.
    if (await recordLifecycle(env, r.lead_id, 'checkout_abandoned', { product, checkout_url: `/checkout?product=${product}`, started_at: r.started }, r.started)) flagged++;
  }
  return { checked: rows.results.length, flagged };
}
