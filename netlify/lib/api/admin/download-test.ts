import { bearerOk, fail, json, notConfigured, type Ctx } from '../../_lib';
import { DIGITAL_KIT_FILE_KEY } from '../../../../src/config/resources';
import { DOWNLOAD_URL_SECONDS } from '../../platform';

/**
 * GET /api/admin/download-test (Authorization: Bearer ADMIN_TOKEN) — a fresh signed link to the Bundle ZIP, made
 * exactly like a buyer's, so the owner can confirm the real file downloads and the link dies after a minute.
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.ADMIN_TOKEN || !env.PRODUCT_FILES) return notConfigured('Admin download test');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const url = await env.PRODUCT_FILES.createDownloadUrl(DIGITAL_KIT_FILE_KEY);
  return json({ key: DIGITAL_KIT_FILE_KEY, expires_in_seconds: DOWNLOAD_URL_SECONDS, url }, 200, { 'Cache-Control': 'no-store' });
};
