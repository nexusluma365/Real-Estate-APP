import { getSession, json, notConfigured, ownedProducts, type Ctx } from '../_lib';
import { premiumStatus } from '../premium';

/** GET /api/entitlements — what this session's customer owns. Visiting a URL never grants access. */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.SESSION_SECRET || !env.DB) return notConfigured('Customer access');
  const s = await getSession(request, env);
  if (!s) return json({ products: [], premium: { active: false } });
  const premium = await premiumStatus(env, s.customer_id, s.lead_id);
  if (!s.customer_id) return json({ products: [], premium, signed_in: true });
  const lead = await env.DB.prepare('SELECT first_name FROM rr_leads WHERE lead_id = ?').bind(s.lead_id).first<{ first_name: string }>();
  return json({ customer_id: s.customer_id, first_name: lead?.first_name, products: await ownedProducts(env, s.customer_id), premium, signed_in: true });
};
