import { body, fail, json, notConfigured, type Ctx } from '../../_lib';
import { parsePlace } from '../../listings';
import { areaStatus, enqueueArea } from '../../scan';

/**
 * POST /api/scan/area { place } — queue an area's apartment communities for an automatic second-chance check
 * (at most once a day per area; the scan-queue job does the work, within SCAN_DAILY_LIMIT).
 * GET  /api/scan/area?place=… — progress: { pending, checked, found }.
 */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.OPENAI_API_KEY || !env.GOOGLE_MAPS_API_KEY) return notConfigured('Second-chance checks');
  const b = await body<{ place?: string }>(request).catch(() => ({}) as { place?: string });
  const place = parsePlace(String(b.place || ''));
  if (!place) return fail(400, 'Enter a city and state.', 'bad_place');
  const r = await enqueueArea(env, place.city, place.state);
  return json({ ...r, ...(await areaStatus(env, place.city, place.state)) });
};

export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.DB) return notConfigured('Second-chance checks');
  const place = parsePlace(new URL(request.url).searchParams.get('place') || '');
  if (!place) return fail(400, 'Enter a city and state.', 'bad_place');
  return json(await areaStatus(env, place.city, place.state));
};
