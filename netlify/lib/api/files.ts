import { fail, getSession, notConfigured, ownedProducts, type Ctx } from '../_lib';

/**
 * GET /api/files?key=creditready/action-plan.pdf — entitlement-checked product file delivery.
 * Streams from the private Netlify Blobs store "product-files". (Alternative: return { url } with a presigned URL;
 * the client supports either — see src/lib/fileService.ts.)
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.SESSION_SECRET || !env.PRODUCT_FILES) return notConfigured('Product files');
  const s = await getSession(request, env);
  if (!s?.customer_id) return fail(401, 'Sign in to download.');
  const key = new URL(request.url).searchParams.get('key') || '';
  const product = key.split('/')[0];
  if (!/^[a-z]+\/[\w.-]+$/.test(key) || !(await ownedProducts(env, s.customer_id)).includes(product as 'creditready')) return fail(403, 'Not included in your purchase.');
  // The video guide is hosted (Vimeo/Wistia/etc.), not a file: redirect entitled owners to the private URL.
  if (key === 'creditready/video-guide') {
    if (!env.VIDEO_GUIDE_URL) return fail(404, 'The video guide link is not configured yet.');
    return new Response(null, { status: 302, headers: { Location: env.VIDEO_GUIDE_URL, 'Cache-Control': 'private, no-store' } });
  }
  const obj = await env.PRODUCT_FILES.get(key);
  if (!obj) return fail(404, 'File not found.');
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${key.split('/')[1]}"`, 'Cache-Control': 'private, no-store' } });
};
