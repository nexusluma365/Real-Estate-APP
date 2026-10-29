import { body, fail, getSession, json, notConfigured, ownedProducts, type Ctx } from '../_lib';
import { parsePlace } from '../listings';
import { premiumStatus } from '../premium';

/**
 * GET  /api/member — the account dashboard: membership, purchases, saved apartments, saved searches, recently viewed.
 * POST /api/member { action, … } — save | unsave | save_search | delete_search | search_alerts | viewed.
 * Saving and alerts are Premium features (checked here, server-side). Saved data is kept if a membership lapses.
 */
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const REF = /^(place|listing):[\w-]{3,250}$/;

export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.SESSION_SECRET) return notConfigured('Accounts');
  const s = await getSession(request, env);
  if (!s) return fail(401, 'Sign in to see your account.', 'no_session');
  const DB = env.DB;
  const key = s.customer_id || s.lead_id;
  const lead = await DB.prepare('SELECT email, first_name, email_consent FROM rr_leads WHERE lead_id = ?').bind(s.lead_id).first<{ email: string; first_name: string; email_consent: number }>();
  const all = <T,>(q: string) => DB.prepare(q).bind(key).all<T>().then((r) => r.results);
  const [premium, products, saved, searches, recent] = await Promise.all([
    premiumStatus(env, s.customer_id, s.lead_id),
    s.customer_id ? ownedProducts(env, s.customer_id) : Promise.resolve([]),
    all<{ ref: string; label: string; detail: string | null; saved_at: string }>('SELECT ref, label, detail, saved_at FROM rr_saved_listings WHERE customer_id = ? ORDER BY saved_at DESC LIMIT 100'),
    all<{ search_id: string; label: string; city: string; state: string; alerts: number; created_at: string }>('SELECT search_id, label, city, state, alerts, created_at FROM rr_saved_searches WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20'),
    all<{ ref: string; label: string; detail: string | null; viewed_at: string }>('SELECT ref, label, detail, viewed_at FROM rr_recent_views WHERE customer_id = ? ORDER BY viewed_at DESC LIMIT 12'),
  ]);
  // New matching listings since each search was saved (verified or standard; never unavailable).
  const fresh = await Promise.all(searches.map(async (q) => ({
    search_id: q.search_id,
    count: (await DB.prepare("SELECT COUNT(*) AS n FROM rr_listings WHERE LOWER(city) = LOWER(?) AND UPPER(state) = UPPER(?) AND classification <> 'unavailable' AND created_at > ?")
      .bind(q.city, q.state, q.created_at).first<{ n: number }>())?.n ?? 0,
  })));
  return json({
    email: lead?.email, first_name: lead?.first_name, marketing_emails: !!lead?.email_consent, premium, products,
    saved, searches: searches.map((q) => ({ ...q, alerts: !!q.alerts, new_count: fresh.find((f) => f.search_id === q.search_id)?.count ?? 0 })), recent,
  });
};

export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.SESSION_SECRET) return notConfigured('Accounts');
  const s = await getSession(request, env);
  if (!s) return fail(401, 'Sign in to save apartments.', 'no_session');
  const b = await body<Record<string, unknown>>(request).catch(() => null);
  if (!b) return fail(400, 'Invalid request.');
  const DB = env.DB;
  const key = s.customer_id || s.lead_id;
  const now = new Date().toISOString();
  const action = String(b.action || '');
  const premium = (await premiumStatus(env, s.customer_id, s.lead_id)).active;
  if (action !== 'unsave' && action !== 'delete_search' && action !== 'search_alerts' && !premium) {
    return fail(402, 'Saving apartments and searches is part of RentReady Premium.', 'premium_required');
  }
  if (action === 'save' || action === 'viewed' || action === 'unsave') {
    const ref = String(b.ref || '');
    if (!REF.test(ref)) return fail(400, 'Invalid apartment.', 'bad_ref');
    if (action === 'unsave') await DB.prepare('DELETE FROM rr_saved_listings WHERE customer_id = ? AND ref = ?').bind(key, ref).run();
    else {
      const table = action === 'save' ? 'rr_saved_listings' : 'rr_recent_views';
      const col = action === 'save' ? 'saved_at' : 'viewed_at';
      await DB.prepare(`INSERT INTO ${table} (customer_id, ref, label, detail, ${col}) VALUES (?, ?, ?, ?, ?) ON CONFLICT(customer_id, ref) DO UPDATE SET label = excluded.label, detail = excluded.detail, ${col} = excluded.${col}`)
        .bind(key, ref, clip(b.label, 120) || 'Apartment', clip(b.detail, 200) || null, now).run();
    }
    return json({ ok: true });
  }
  if (action === 'save_search') {
    const place = parsePlace(String(b.place || ''));
    if (!place) return fail(422, 'Saved searches need a city and state, e.g. “Charlotte, NC”.', 'bad_place');
    const n = (await DB.prepare('SELECT COUNT(*) AS n FROM rr_saved_searches WHERE customer_id = ?').bind(key).first<{ n: number }>())?.n ?? 0;
    if (n >= 20) return fail(409, 'You can keep up to 20 saved searches. Remove one to add another.', 'limit');
    const dup = await DB.prepare('SELECT search_id FROM rr_saved_searches WHERE customer_id = ? AND LOWER(city) = LOWER(?) AND UPPER(state) = UPPER(?)').bind(key, place.city, place.state).first<{ search_id: string }>();
    if (dup) return json({ ok: true, search_id: dup.search_id, existing: true });
    const id = `srch_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await DB.prepare('INSERT INTO rr_saved_searches (search_id, customer_id, label, city, state, alerts, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .bind(id, key, `${place.city}, ${place.state}`, place.city, place.state, now).run();
    return json({ ok: true, search_id: id });
  }
  if (action === 'delete_search' || action === 'search_alerts') {
    const id = String(b.search_id || '');
    if (action === 'delete_search') await DB.prepare('DELETE FROM rr_saved_searches WHERE customer_id = ? AND search_id = ?').bind(key, id).run();
    else await DB.prepare('UPDATE rr_saved_searches SET alerts = ? WHERE customer_id = ? AND search_id = ?').bind(b.alerts ? 1 : 0, key, id).run();
    return json({ ok: true });
  }
  return fail(400, 'Unknown action.', 'bad_action');
};
