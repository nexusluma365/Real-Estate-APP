import { body, fail, getSession, json, notConfigured, stripe, type Ctx } from '../../_lib';
import { safeReturn } from '../../premium';

/** POST /api/premium/portal { return_to } — Stripe customer portal: update card, invoices, cancel. */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_SECRET_KEY || !env.SESSION_SECRET || !env.DB) return notConfigured('Billing');
  const s = await getSession(request, env);
  if (!s) return fail(401, 'Sign in to manage your membership.', 'no_session');
  const sub = await env.DB.prepare('SELECT customer_id FROM rr_subscriptions WHERE customer_id = ? OR lead_id = ? ORDER BY updated_at DESC')
    .bind(s.customer_id || '', s.lead_id).first<{ customer_id: string }>();
  if (!sub) return fail(404, 'There’s no membership on this account.', 'no_membership');
  const b = await body<{ return_to?: string }>(request).catch(() => ({} as { return_to?: string }));
  const origin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  const configs = await stripe<{ data: { id: string; metadata?: { rentready?: string } }[] }>(env, 'GET', 'billing_portal/configurations', { active: 'true', limit: '20' });
  const config = configs.data.find((c) => c.metadata?.rentready === 'premium');
  const portal = await stripe<{ url: string }>(env, 'POST', 'billing_portal/sessions', {
    customer: sub.customer_id,
    return_url: `${origin}${safeReturn(b.return_to, '/account')}`,
    ...(config ? { configuration: config.id } : {}),
  });
  return json({ url: portal.url });
};
