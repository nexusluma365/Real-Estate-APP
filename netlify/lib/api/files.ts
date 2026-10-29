import { fail as apiFail, getSession, notConfigured, ownedProducts, type Ctx } from '../_lib';
import { readDownloadToken } from '../email';
import { RESOURCES } from '../../../src/config/resources';

/**
 * GET /api/files?key=CREDIT%20REPAIR%20TOOLKIT%E2%84%A2.zip — entitlement-checked product file delivery.
 * Redirects to a five-minute signed URL from the private Cloudflare R2 bucket.
 * GET /api/files?t=… — the same, from a signed link in the receipt email (no browser session needed).
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  const url = new URL(request.url);
  // A customer clicking a download link gets the access page with a plain-English note, not a JSON error.
  const browser = (request.headers.get('Accept') || '').includes('text/html');
  const fail = (status: number, error: string, reason: string) =>
    browser ? Response.redirect(`${url.origin}/access?download=${reason}`, 302) : apiFail(status, error);
  if (!env.SESSION_SECRET || !env.PRODUCT_FILES) return browser ? fail(501, '', 'unavailable') : notConfigured('Product files');
  const emailed = url.searchParams.get('t');
  let customerId: string | undefined;
  let key = url.searchParams.get('key') || '';
  if (emailed) {
    const t = await readDownloadToken(env, emailed);
    if (!t) return Response.redirect(`${url.origin}/access?link=expired`, 302);
    ({ customerId, key } = t);
  } else {
    customerId = (await getSession(request, env))?.customer_id;
  }
  if (!customerId) return fail(401, 'Sign in to download.', 'signin');
  const resource = RESOURCES.find((item) => item.fileKey === key);
  if (!resource) return fail(404, 'File not found.', 'unavailable');
  if (!(await ownedProducts(env, customerId)).includes(resource.product)) return fail(403, 'Not included in your purchase.', 'not_owned');
  // The video guide is hosted (Vimeo/Wistia/etc.), not a file: redirect entitled owners to the private URL.
  if (key === 'creditready/video-guide') {
    if (!env.VIDEO_GUIDE_URL) return fail(404, 'The video guide link is not configured yet.', 'unavailable');
    return new Response(null, { status: 302, headers: { Location: env.VIDEO_GUIDE_URL, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  const downloadUrl = await env.PRODUCT_FILES.createDownloadUrl(key);
  if (!downloadUrl) return fail(404, 'File not found.', 'unavailable');
  return new Response(null, { status: 302, headers: { Location: downloadUrl, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
};
