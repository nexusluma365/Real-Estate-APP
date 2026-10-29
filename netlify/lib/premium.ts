import { recordLifecycle, setSession, stripe, type Env } from './_lib';

/**
 * RentReady Premium: $5 for the first month, then $19.99/month until canceled (Stripe Billing).
 * Stripe is the source of truth; rr_subscriptions mirrors it from webhooks and the checkout return.
 * Published access policy (shown in the offer and in emails):
 * - active / trialing → access
 * - past_due (a renewal failed; Stripe retries it) → access for GRACE_DAYS after the period end
 * - canceled at period end → access until the paid period ends; then none
 */
export const PREMIUM = {
  priceCents: 1999,
  introCents: 500,
  priceLookupKey: 'rentready_premium_monthly',
  introCouponId: 'rentready_premium_intro',
  graceDays: 7,
} as const;

export interface SubRow { subscription_id: string; customer_id: string; lead_id: string | null; status: string; current_period_end: string | null; cancel_at_period_end: number; canceled_at: string | null; intro_used: number }
export interface PremiumStatus { active: boolean; status: string | null; current_period_end: string | null; cancel_at_period_end: boolean; grace_until: string | null; had_premium: boolean }

const NONE: PremiumStatus = { active: false, status: null, current_period_end: null, cancel_at_period_end: false, grace_until: null, had_premium: false };

export function accessFrom(sub: Pick<SubRow, 'status' | 'current_period_end'>, now = Date.now()): { active: boolean; grace_until: string | null } {
  const end = sub.current_period_end ? Date.parse(sub.current_period_end) : 0;
  if (sub.status === 'active' || sub.status === 'trialing') return { active: true, grace_until: null };
  if (sub.status === 'past_due' && end) {
    const grace = end + PREMIUM.graceDays * 86400000;
    return { active: now < grace, grace_until: new Date(grace).toISOString() };
  }
  return { active: false, grace_until: null };
}

/** Membership for a session: by Stripe customer, or by lead (a member may have paid with a separate Stripe customer). */
export async function premiumStatus(env: Env, customerId?: string, leadId?: string): Promise<PremiumStatus> {
  if (!env.DB || (!customerId && !leadId)) return NONE;
  let rows: SubRow[];
  try {
    rows = (await env.DB.prepare('SELECT * FROM rr_subscriptions WHERE customer_id = ? OR lead_id = ? ORDER BY updated_at DESC')
      .bind(customerId || '', leadId || '').all<SubRow>()).results;
  } catch (e) {
    // Fail safe: a membership lookup problem (e.g. the Premium migration not applied yet) must never block book buyers.
    console.error('premiumStatus: membership lookup failed', e);
    return NONE;
  }
  if (!rows.length) return NONE;
  const best = rows.find((r) => accessFrom(r).active) || rows[0];
  const a = accessFrom(best);
  return { active: a.active, status: best.status, current_period_end: best.current_period_end, cancel_at_period_end: !!best.cancel_at_period_end, grace_until: a.grace_until, had_premium: true };
}

/** A Stripe Subscription object (any API version: the period end moved onto the items in 2025). */
export interface StripeSub {
  id: string; customer: string; status: string; cancel_at_period_end: boolean; canceled_at: number | null;
  current_period_end?: number; items?: { data: { current_period_end?: number }[] }; metadata?: { lead_id?: string };
}
const periodEnd = (s: StripeSub) => {
  const t = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return t ? new Date(t * 1000).toISOString() : null;
};

/** Mirrors a subscription; returns the previous row so callers can detect transitions. */
export async function upsertSubscription(env: Env, s: StripeSub, leadId?: string | null): Promise<SubRow | null> {
  const DB = env.DB!;
  const prev = await DB.prepare('SELECT * FROM rr_subscriptions WHERE subscription_id = ?').bind(s.id).first<SubRow>();
  const now = new Date().toISOString();
  const lead = leadId || s.metadata?.lead_id || prev?.lead_id || null;
  await DB.prepare(
    `INSERT INTO rr_subscriptions (subscription_id, customer_id, lead_id, status, current_period_end, cancel_at_period_end, canceled_at, intro_used, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(subscription_id) DO UPDATE SET status = excluded.status, current_period_end = COALESCE(excluded.current_period_end, rr_subscriptions.current_period_end),
       cancel_at_period_end = excluded.cancel_at_period_end, canceled_at = excluded.canceled_at, lead_id = COALESCE(rr_subscriptions.lead_id, excluded.lead_id), updated_at = excluded.updated_at`,
  ).bind(s.id, s.customer, lead, s.status, periodEnd(s), s.cancel_at_period_end ? 1 : 0, s.canceled_at ? new Date(s.canceled_at * 1000).toISOString() : null, now, now).run();
  return prev;
}

export async function leadForCustomer(env: Env, customerId: string): Promise<string | null> {
  const DB = env.DB!;
  const sub = await DB.prepare('SELECT lead_id FROM rr_subscriptions WHERE customer_id = ? AND lead_id IS NOT NULL').bind(customerId).first<{ lead_id: string }>();
  if (sub) return sub.lead_id;
  return (await DB.prepare('SELECT lead_id FROM rr_leads WHERE stripe_customer_id = ?').bind(customerId).first<{ lead_id: string }>())?.lead_id || null;
}

/** Creates (or finds) the lead for an email collected by Stripe Checkout. Never raises marketing consent. */
export async function leadForEmail(env: Env, email: string, name: string, customerId: string): Promise<string> {
  const DB = env.DB!;
  const e = email.trim().toLowerCase();
  const found = await DB.prepare('SELECT lead_id FROM rr_leads WHERE email = ?').bind(e).first<{ lead_id: string }>();
  if (found) {
    await DB.prepare('UPDATE rr_leads SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE lead_id = ?').bind(customerId, found.lead_id).run();
    return found.lead_id;
  }
  const id = `lead_${crypto.randomUUID().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  await DB.prepare('INSERT INTO rr_leads (lead_id, email, first_name, email_consent, lead_source, product_interest, stripe_customer_id, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)')
    .bind(id, e, name.trim().split(/\s+/)[0]?.slice(0, 40) || '', 'premium', 'premium', customerId, now, now).run();
  return id;
}

interface CheckoutSession { id: string; mode: string; status: string; customer: string; customer_details?: { email?: string; name?: string }; metadata?: { lead_id?: string }; subscription: StripeSub | string | null }

/**
 * Activates membership from a completed Checkout Session (called by the browser return AND the webhook — idempotent).
 * Returns the Set-Cookie for the member's session.
 */
export async function activateFromCheckout(env: Env, sessionId: string): Promise<{ cookie: string; active: boolean } | null> {
  const cs = await stripe<CheckoutSession>(env, 'GET', `checkout/sessions/${encodeURIComponent(sessionId)}`, { 'expand[]': 'subscription' });
  if (cs.mode !== 'subscription' || cs.status !== 'complete' || !cs.subscription || typeof cs.subscription === 'string') return null;
  const email = cs.customer_details?.email;
  let leadId = cs.metadata?.lead_id || null;
  if (!leadId && email) leadId = await leadForEmail(env, email, cs.customer_details?.name || '', cs.customer);
  if (!leadId) return null;
  await upsertSubscription(env, cs.subscription, leadId);
  const lead = await env.DB!.prepare('SELECT stripe_customer_id FROM rr_leads WHERE lead_id = ?').bind(leadId).first<{ stripe_customer_id: string | null }>();
  if (!lead?.stripe_customer_id) await env.DB!.prepare('UPDATE rr_leads SET stripe_customer_id = ? WHERE lead_id = ?').bind(cs.customer, leadId).run();
  await recordLifecycle(env, leadId, 'premium_started', { subscription_id: cs.subscription.id, current_period_end: periodEnd(cs.subscription) }, cs.subscription.id);
  // Keep the customer id that owns any book/Bundle purchases, so the session sees everything this person bought.
  const customerId = lead?.stripe_customer_id || cs.customer;
  return { cookie: await setSession(env, { lead_id: leadId, customer_id: customerId }), active: accessFrom({ status: cs.subscription.status, current_period_end: periodEnd(cs.subscription) }).active };
}

/** Only same-site relative paths may be used as a return destination. */
export function safeReturn(to: unknown, fallback = '/finder/'): string {
  const t = typeof to === 'string' ? to : '';
  return /^\/(?!\/)[\w\-./?=&%:+~#]*$/.test(t) && !t.includes('\\') ? t.slice(0, 500) : fallback;
}
