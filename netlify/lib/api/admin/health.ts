import { bearerOk, fail, json, notConfigured, type Ctx } from '../../_lib';
import { RESOURCES } from '../../../../src/config/resources';

/**
 * GET /api/admin/health (Authorization: Bearer ADMIN_TOKEN) — launch readiness without exposing any value:
 * which settings are present, whether the database answers, and whether each product file is in R2.
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.ADMIN_TOKEN) return notConfigured('Admin health');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const settings = {
    stripe_secret_key: !!env.STRIPE_SECRET_KEY,
    stripe_webhook_secret: !!env.STRIPE_WEBHOOK_SECRET,
    session_secret: !!env.SESSION_SECRET,
    allowed_origin: env.ALLOWED_ORIGIN || null,
    database: !!env.DB,
    product_files: !!env.PRODUCT_FILES,
    resend_email: !!(env.RESEND_API_KEY && env.FROM_EMAIL),
    video_guide_url: !!env.VIDEO_GUIDE_URL,
  };
  let database: string;
  try {
    database = env.DB ? `ok (${(await env.DB.prepare('SELECT COUNT(*) AS n FROM rr_leads').bind().first<{ n: number }>())?.n ?? 0} leads)` : 'not configured';
  } catch (e) {
    database = `error: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}`;
  }
  const files: Record<string, string> = {};
  for (const r of RESOURCES.filter((x) => x.kind !== 'Video')) {
    try {
      files[r.fileKey] = !env.PRODUCT_FILES?.exists ? 'not configured' : (await env.PRODUCT_FILES.exists(r.fileKey)) ? 'uploaded' : 'MISSING';
    } catch (e) {
      files[r.fileKey] = `error: ${e instanceof Error ? e.message.slice(0, 160) : 'unknown'}`;
    }
  }
  return json({ settings, database, files });
};
