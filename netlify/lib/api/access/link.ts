import { body, json, notConfigured, ownedProducts, recordLifecycle, type Ctx } from '../../_lib';

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * POST /api/access/link — magic-link sign-in for returning customers.
 * Always responds the same way (no account enumeration). For a customer, stores a hash of a single-use
 * 30-minute token and emits `access_link_requested` (transactional) so the ESP emails the link.
 * Rate-limit this path (Netlify rate-limit rules).
 */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.SESSION_SECRET || !env.DB) return notConfigured('Sign-in links');
  const b = await body<{ email?: string }>(request).catch(() => ({}) as { email?: string });
  const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
  const lead = email ? await env.DB.prepare('SELECT lead_id, stripe_customer_id FROM rr_leads WHERE email = ?').bind(email).first<{ lead_id: string; stripe_customer_id: string | null }>() : null;
  if (lead?.stripe_customer_id && (await ownedProducts(env, lead.stripe_customer_id)).length) {
    const raw = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, '0')).join('');
    const hash = await sha256(raw);
    await env.DB.prepare('INSERT INTO rr_access_tokens (token_hash, lead_id, expires_at) VALUES (?, ?, ?)').bind(hash, lead.lead_id, new Date(Date.now() + 30 * 60 * 1000).toISOString()).run();
    const origin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
    await recordLifecycle(env, lead.lead_id, 'access_link_requested', { link: `${origin}/api/access/verify?token=${raw}` }, hash.slice(0, 16));
  }
  return json({ sent: true });
};
