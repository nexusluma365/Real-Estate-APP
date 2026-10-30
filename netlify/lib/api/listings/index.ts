import { fail, getSession, json, notConfigured, type Ctx } from '../../_lib';
import { listingsIn, mixListings, parsePlace, present, secondChanceInState, type ListingRow } from '../../listings';
import { premiumStatus } from '../../premium';

/**
 * GET /api/listings?place=Charlotte, NC (or ?city=&state=) [&min_rent=&max_rent= (dollars) &beds= (minimum) &second_chance=1]
 * — RentReady listings for a city. Premium details gated server-side. A listing without a rent or bedroom count is kept
 * when that filter is set (never silently hidden); `filtered_out` says how many were excluded.
 * Normal results mix second-chance listings in; second_chance=1 returns only those. When the city has no verified
 * second-chance listing, up to 3 from elsewhere in the state are added and flagged `nearby` (shown as such).
 */
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
  const n = (k: string) => (q.get(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
  const [min, max, beds] = [n('min_rent'), n('max_rent'), n('beds')];
  const onlySecondChance = q.get('second_chance') === '1';
  const fits = (r: ListingRow) =>
    (min == null || r.rent_cents == null || r.rent_cents >= min * 100) &&
    (max == null || r.rent_cents == null || r.rent_cents <= max * 100) &&
    (beds == null || r.beds == null || r.beds >= beds);
  const kept = rows.filter((r) => (!onlySecondChance || r.classification === 'verified_second_chance') && fits(r));
  const nearby = kept.some((r) => r.classification === 'verified_second_chance')
    ? []
    : (await secondChanceInState(env, place.city, place.state).catch(() => [] as ListingRow[])).filter(fits);
  const ordered = onlySecondChance ? kept : mixListings(kept);
  const listings = [...ordered.map((r) => present(r, premium)), ...nearby.map((r) => ({ ...present(r, premium), nearby: true }))];
  return json({
    place, premium, listings, filtered_out: rows.filter((r) => !onlySecondChance || r.classification === 'verified_second_chance').length - kept.length,
    locked_count: premium ? 0 : listings.filter((l) => l.locked).length,
  });
};
