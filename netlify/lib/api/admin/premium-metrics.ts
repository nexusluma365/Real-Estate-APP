import { bearerOk, fail, json, notConfigured, type Ctx } from '../../_lib';
import { accessFrom, PREMIUM, type SubRow } from '../../premium';

/**
 * GET /api/admin/premium-metrics?days=30 (Authorization: Bearer ADMIN_TOKEN) — RentReady Premium and listings.
 * Counts and sums only. MRR = active members × $19.99 (members still in their $5 month counted at $19.99 from renewal).
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.ADMIN_TOKEN) return notConfigured('Admin metrics');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const days = Math.min(365, Math.max(1, Number(new URL(request.url).searchParams.get('days')) || 30));
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const DB = env.DB;
  const subs = (await DB.prepare('SELECT * FROM rr_subscriptions').bind().all<SubRow & { created_at: string }>()).results;
  const invoices = (await DB.prepare('SELECT subscription_id, amount_cents, billing_reason, status, refunded_cents, created_at FROM rr_premium_invoices').bind()
    .all<{ subscription_id: string; amount_cents: number; billing_reason: string | null; status: string; refunded_cents: number; created_at: string }>()).results;
  const paidCycles = (id: string) => invoices.filter((i) => i.subscription_id === id && i.status === 'paid' && i.billing_reason === 'subscription_cycle').length;
  const withAccess = subs.filter((s) => accessFrom(s).active);
  const inWindow = <T extends { created_at: string }>(rows: T[]) => rows.filter((r) => r.created_at >= since);
  const renewalsPaid = inWindow(invoices).filter((i) => i.billing_reason === 'subscription_cycle' && i.status === 'paid').length;
  const renewalsFailed = inWindow(invoices).filter((i) => i.billing_reason === 'subscription_cycle' && i.status === 'failed').length;
  const ev = async (name: string) => (await DB.prepare('SELECT COUNT(*) AS n FROM rr_events WHERE event = ? AND at >= ?').bind(name, since).first<{ n: number }>())?.n ?? 0;
  const listings = (await DB.prepare('SELECT classification AS k, COUNT(*) AS n FROM rr_listings GROUP BY classification').bind().all<{ k: string; n: number }>()).results;
  const stale = (await DB.prepare("SELECT COUNT(*) AS n FROM rr_listings WHERE classification = 'verified_second_chance' AND (verified_at IS NULL OR verified_at < ?)")
    .bind(new Date(Date.now() - 30 * 86400000).toISOString()).first<{ n: number }>())?.n ?? 0;
  const [opened, located, searches, lockedViews, unlockClicks, offerViews, checkoutStarts, unlockedViews] = await Promise.all([
    ev('finder_opened'), ev('finder_location_set'), ev('finder_search'), ev('locked_listing_view'), ev('premium_unlock_click'),
    ev('membership_offer_view'), ev('membership_checkout_started'), ev('premium_listing_unlocked')]);
  const coverage = (await DB.prepare(
    "SELECT city || ', ' || state AS k, COUNT(*) AS n, SUM(CASE WHEN classification = 'verified_second_chance' THEN 1 ELSE 0 END) AS verified FROM rr_listings WHERE classification <> 'unavailable' GROUP BY city, state ORDER BY n DESC LIMIT 30",
  ).bind().all<{ k: string; n: number; verified: number }>()).results;
  const saved = await DB.prepare('SELECT COUNT(*) AS n, SUM(alerts) AS alerts, COUNT(DISTINCT customer_id) AS members FROM rr_saved_searches').bind().first<{ n: number; alerts: number | null; members: number }>();
  const renewedOnce = subs.filter((s) => paidCycles(s.subscription_id) >= 1).length;
  const started = inWindow(subs).length;
  return json({
    days,
    members: {
      with_access: withAccess.length,
      intro_month: withAccess.filter((s) => paidCycles(s.subscription_id) === 0).length,
      past_due: subs.filter((s) => s.status === 'past_due').length,
      canceling: withAccess.filter((s) => s.cancel_at_period_end).length,
      started,
      ended: subs.filter((s) => s.status === 'canceled' && (s.canceled_at || '') >= since).length,
      mrr_cents: withAccess.filter((s) => !s.cancel_at_period_end).length * PREMIUM.priceCents,
    },
    billing: {
      revenue_cents: inWindow(invoices).filter((i) => i.status === 'paid').reduce((n, i) => n + i.amount_cents, 0),
      refunded_cents: inWindow(invoices).reduce((n, i) => n + (i.refunded_cents || 0), 0),
      renewals_paid: renewalsPaid,
      renewals_failed: renewalsFailed,
      renewal_success_rate: renewalsPaid + renewalsFailed ? renewalsPaid / (renewalsPaid + renewalsFailed) : null,
    },
    funnel: {
      finder_opened: opened, location_set: located, finder_searches: searches, locked_listing_views: lockedViews, unlock_clicks: unlockClicks,
      offer_views: offerViews, checkout_starts: checkoutStarts, joins: started, premium_listings_unlocked: unlockedViews,
      reached_first_renewal: renewedOnce,
    },
    listings: { by_classification: listings, needs_reverification: stale, coverage },
    saved_searches: { total: saved?.n ?? 0, with_alerts: Number(saved?.alerts ?? 0), members: saved?.members ?? 0 },
  });
};
