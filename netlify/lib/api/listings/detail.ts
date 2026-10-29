import { fail, getSession, json, notConfigured, type Ctx } from '../../_lib';
import { present, type ListingRow } from '../../listings';
import { premiumStatus } from '../../premium';

/** GET /api/listings/detail?id=… — one listing; a locked second-chance listing returns only its public fields. */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.DB) return notConfigured('Listings');
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[\w-]{3,80}$/.test(id)) return fail(400, 'Invalid listing.', 'bad_id');
  const row = await env.DB.prepare('SELECT * FROM rr_listings WHERE listing_id = ?').bind(id).first<ListingRow>();
  if (!row) return fail(404, 'This listing is no longer available.', 'not_found');
  const s = await getSession(request, env);
  const premium = (await premiumStatus(env, s?.customer_id, s?.lead_id)).active;
  return json({ premium, listing: present(row, premium) });
};
