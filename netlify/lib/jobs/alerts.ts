import { recordLifecycle, type Env } from '../_lib';
import { premiumStatus } from '../premium';

/**
 * New-listing alerts for saved searches (Premium members with alerts on). Each listing is announced to a search once
 * (rr_alerts_sent), unavailable listings are never announced, and nothing is sent when nothing is new.
 */
export async function sendListingAlerts(env: Env, now = new Date()) {
  const DB = env.DB!;
  const searches = (await DB.prepare('SELECT search_id, customer_id, city, state, label, created_at FROM rr_saved_searches WHERE alerts = 1 LIMIT 2000').bind()
    .all<{ search_id: string; customer_id: string; city: string; state: string; label: string; created_at: string }>()).results;
  let sent = 0;
  for (const q of searches) {
    const leadId = q.customer_id.startsWith('lead_') ? q.customer_id
      : (await DB.prepare('SELECT lead_id FROM rr_leads WHERE stripe_customer_id = ?').bind(q.customer_id).first<{ lead_id: string }>())?.lead_id
        || (await DB.prepare('SELECT lead_id FROM rr_subscriptions WHERE customer_id = ? AND lead_id IS NOT NULL').bind(q.customer_id).first<{ lead_id: string }>())?.lead_id;
    if (!leadId) continue;
    const isCustomer = q.customer_id.startsWith('cus_');
    if (!(await premiumStatus(env, isCustomer ? q.customer_id : undefined, leadId)).active) continue;
    const fresh = (await DB.prepare(
      `SELECT l.listing_id, l.classification, l.rent_cents, l.rent_max_cents, l.beds FROM rr_listings l
        WHERE LOWER(l.city) = LOWER(?) AND UPPER(l.state) = UPPER(?) AND l.classification <> 'unavailable' AND l.created_at > ?
          AND NOT EXISTS (SELECT 1 FROM rr_alerts_sent a WHERE a.search_id = ? AND a.listing_id = l.listing_id) LIMIT 20`,
    ).bind(q.city, q.state, q.created_at, q.search_id).all<{ listing_id: string; classification: string; rent_cents: number | null; rent_max_cents: number | null; beds: number | null }>()).results;
    if (!fresh.length) continue;
    const items = fresh.map((l) => [l.classification === 'verified_second_chance' ? 'Second-chance apartment' : 'Apartment',
      l.rent_cents ? `$${Math.round(l.rent_cents / 100).toLocaleString('en-US')}${l.rent_max_cents && l.rent_max_cents > l.rent_cents ? `–$${Math.round(l.rent_max_cents / 100).toLocaleString('en-US')}` : ''}/mo` : null, l.beds != null ? `${l.beds === 0 ? 'Studio' : `${l.beds} bed`}` : null].filter(Boolean).join(' · '));
    await recordLifecycle(env, leadId, 'listing_alert', { place: q.label, items }, `${q.search_id}:${now.toISOString().slice(0, 10)}:${fresh.map((f) => f.listing_id).join(',')}`.slice(0, 250));
    for (const l of fresh) await DB.prepare('INSERT INTO rr_alerts_sent (search_id, listing_id, sent_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(q.search_id, l.listing_id, now.toISOString()).run();
    sent++;
  }
  return { searches: searches.length, alerts_sent: sent };
}
