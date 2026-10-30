import { fail, notConfigured, type Ctx } from '../../_lib';
import { googlePhotoName, type ListingRow } from '../../listings';

/**
 * GET /api/listings/preview?id=… — a 48-pixel-wide version of a listing's Google photo for the blurred locked card.
 * At that size nothing identifying survives, so it's safe to send to anyone; the full photo stays a Premium detail.
 */
const WIDTH = 48;

export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.GOOGLE_MAPS_API_KEY) return notConfigured('Previews');
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[\w-]{3,80}$/.test(id)) return fail(400, 'Invalid listing.', 'bad_id');
  const row = await env.DB.prepare("SELECT photo_url FROM rr_listings WHERE listing_id = ? AND classification <> 'unavailable'").bind(id).first<Pick<ListingRow, 'photo_url'>>();
  const name = googlePhotoName(row?.photo_url ?? null);
  if (!name) return fail(404, 'No preview.', 'no_preview');
  const r = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=${WIDTH}&skipHttpRedirect=true`, { headers: { 'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY } });
  const d = (await r.json().catch(() => ({}))) as { photoUri?: string };
  if (!r.ok || !d.photoUri) return fail(404, 'No preview.', 'no_preview');
  return new Response(null, { status: 302, headers: { Location: d.photoUri, 'Cache-Control': 'public, max-age=3600' } });
};
