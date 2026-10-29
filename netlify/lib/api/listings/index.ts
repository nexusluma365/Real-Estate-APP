import { fail, getSession, json, notConfigured, type Ctx } from '../../_lib';
import { listingsIn, parsePlace, present } from '../../listings';
import { premiumStatus } from '../../premium';

/** GET /api/listings?place=Charlotte, NC (or ?city=&state=) — RentReady listings for a city. Premium details gated server-side. */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.DB) return notConfigured('Listings');
  const q = new URL(request.url).searchParams;
  const place = q.get('city') && q.get('state') ? { city: q.get('city')!, state: q.get('state')! } : parsePlace(q.get('place') || '');
  if (!place || place.city.length > 80) return fail(400, 'Enter a city and state, e.g. “Charlotte, NC”.', 'bad_place');
  const s = await getSession(request, env);
  const premium = (await premiumStatus(env, s?.customer_id, s?.lead_id)).active;
  const rows = await listingsIn(env, place.city, place.state).catch((e) => {
    console.error('listings: lookup failed', e);
    return [];
  });
  return json({ place, premium, listings: rows.map((r) => present(r, premium)), locked_count: premium ? 0 : rows.filter((r) => r.classification === 'verified_second_chance').length });
};
