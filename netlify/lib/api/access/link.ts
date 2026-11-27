import { body, json, notConfigured, ownedProducts, recordLifecycle, type Ctx } from '../../_lib';
import { premiumStatus, safeReturn } from '../../premium';
import { issueAccessLink } from '../../delivery';

/**
 * POST /api/access/link { email, next? } — magic-link sign-in for returning customers, Premium members (current or past)
 * and people who finished the apartment-match questionnaire (they have a saved search).
 * `next` (a same-site path) is where the link signs them in to; default /access.
 * Always responds the same way (no account enumeration). For a customer, stores a hash of a single-use
 * 30-minute token and emits `access_link_requested` (transactional) so the ESP emails the link.
 * Rate-limit this path (Netlify rate-limit rules).
 */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.SESSION_SECRET || !env.DB) return notConfigured('Sign-in links');
  const b = await body<{ email?: string; next?: string }>(request).catch(() => ({}) as { email?: string; next?: string });
  const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
  const lead = email ? await env.DB.prepare('SELECT lead_id, stripe_customer_id FROM rr_leads WHERE email = ?').bind(email).first<{ lead_id: string; stripe_customer_id: string | null }>() : null;
  const customer = !!lead?.stripe_customer_id && ((await ownedProducts(env, lead.stripe_customer_id)).length > 0 || (await premiumStatus(env, lead.stripe_customer_id, lead.lead_id)).had_premium);
  const searched = !!lead && !customer && !!(await env.DB.prepare("SELECT 1 AS x FROM rr_lifecycle_events WHERE lead_id = ? AND event = 'search_saved' LIMIT 1").bind(lead.lead_id).first());
  const known = customer || searched;
  if (lead && known) {
    const { link, hash } = await issueAccessLink(env, lead.lead_id, { ttlMs: 30 * 60 * 1000, reusable: false, next: b.next ? safeReturn(b.next, '/access') : undefined });
    await recordLifecycle(env, lead.lead_id, 'access_link_requested', { link }, hash.slice(0, 16));
  }
  return json({ sent: true });
};
