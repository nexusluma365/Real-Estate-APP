import { bearerOk, body, fail, json, notConfigured, type Ctx } from '../../_lib';

/**
 * POST /api/esp/unsubscribe { email } — called by the ESP's unsubscribe webhook (Authorization: Bearer ESP_WEBHOOK_SECRET)
 * so RentReady's own record matches. forwardToEsp then sends marketing_allowed=false for this lead forever.
 * Transactional email (receipts, access links, refund confirmations) is unaffected.
 */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.ESP_WEBHOOK_SECRET) return notConfigured('Unsubscribe sync');
  if (!bearerOk(request, env.ESP_WEBHOOK_SECRET)) return fail(401, 'Unauthorized.');
  const b = await body<{ email?: string }>(request).catch(() => ({}) as { email?: string });
  const email = String(b.email || '').trim().toLowerCase();
  if (!email) return fail(400, 'email required');
  await env.DB.prepare('UPDATE leads SET email_consent = 0, unsubscribed_at = ? WHERE email = ?').bind(new Date().toISOString(), email).run();
  return json({ ok: true });
};
