import { getSession, json, notConfigured, ownedProducts, type Ctx, type Env } from '../_lib';
import { premiumStatus } from '../premium';

/** The place from this lead's latest apartment-match search (the questionnaire's `search_saved` event). */
async function lastSearch(env: Env, leadId: string) {
  const row = await env.DB!.prepare("SELECT data FROM rr_lifecycle_events WHERE lead_id = ? AND event = 'search_saved' ORDER BY at DESC LIMIT 1").bind(leadId).first<{ data: string }>();
  try {
    const place = row ? (JSON.parse(row.data) as { place?: unknown }).place : null;
    return typeof place === 'string' && place.trim() ? { place: place.slice(0, 120) } : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/entitlements — what this session's customer owns. Visiting a URL never grants access.
 * `verified` = the session was proved by a payment or a sign-in link. Only then are the name and saved search returned:
 * a plain lead session can be had by typing anyone's email into a lead form.
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.SESSION_SECRET || !env.DB) return notConfigured('Customer access');
  const s = await getSession(request, env);
  if (!s) return json({ products: [], premium: { active: false } });
  const premium = await premiumStatus(env, s.customer_id, s.lead_id);
  const verified = !!(s.customer_id || s.verified);
  if (!verified) return json({ products: [], premium, signed_in: true, verified });
  const [lead, products, last_search] = await Promise.all([
    env.DB.prepare('SELECT first_name FROM rr_leads WHERE lead_id = ?').bind(s.lead_id).first<{ first_name: string }>(),
    s.customer_id ? ownedProducts(env, s.customer_id) : Promise.resolve([]),
    lastSearch(env, s.lead_id),
  ]);
  return json({ customer_id: s.customer_id, first_name: lead?.first_name, products, premium, signed_in: true, verified, last_search });
};
