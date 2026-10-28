import { fail, getSession, notConfigured, ownedProducts, type Ctx } from '../_lib';
import { RESOURCES } from '../../../src/config/resources';

/**
 * GET /api/files?key=CREDIT%20REPAIR%20TOOLKIT%E2%84%A2.zip — entitlement-checked product file delivery.
 * Redirects to a five-minute signed URL from the private Cloudflare R2 bucket.
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.SESSION_SECRET || !env.PRODUCT_FILES) return notConfigured('Product files');
  const s = await getSession(request, env);
  if (!s?.customer_id) return fail(401, 'Sign in to download.');
  const key = new URL(request.url).searchParams.get('key') || '';
  const resource = RESOURCES.find((item) => item.fileKey === key);
  if (!resource) return fail(404, 'File not found.');
  if (!(await ownedProducts(env, s.customer_id)).includes(resource.product)) return fail(403, 'Not included in your purchase.');
  // The video guide is hosted (Vimeo/Wistia/etc.), not a file: redirect entitled owners to the private URL.
  if (key === 'creditready/video-guide') {
    if (!env.VIDEO_GUIDE_URL) return fail(404, 'The video guide link is not configured yet.');
    return new Response(null, { status: 302, headers: { Location: env.VIDEO_GUIDE_URL, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  const downloadUrl = await env.PRODUCT_FILES.createDownloadUrl(key);
  if (!downloadUrl) return fail(404, 'File not found.');
  return new Response(null, { status: 302, headers: { Location: downloadUrl, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' } });
};
