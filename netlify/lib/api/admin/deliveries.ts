import { bearerOk, body, fail, json, notConfigured, type Ctx } from '../../_lib';
import { deliverOrder } from '../../delivery';
import { orderRef } from '../../email';

/**
 * Digital delivery log for /admin (Authorization: Bearer ADMIN_TOKEN).
 * GET  /api/admin/deliveries — the last 30 days of package emails: status, attempts, last error.
 * POST /api/admin/deliveries { order_id, resend? } — sends a package email that failed or never went out; with
 *      resend: true it also re-sends one that was delivered (customer says it never arrived).
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.ADMIN_TOKEN) return notConfigured('Admin deliveries');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const rows = (await env.DB.prepare(
    `SELECT d.order_id, d.product, d.status, d.attempts, d.last_error, d.created_at, d.sent_at, l.email
       FROM rr_deliveries d LEFT JOIN rr_leads l ON l.lead_id = d.lead_id WHERE d.created_at >= ? ORDER BY d.created_at DESC LIMIT 200`,
  ).bind(since).all<{ order_id: string; product: string; status: string; attempts: number; last_error: string | null; created_at: string; sent_at: string | null; email: string | null }>()).results;
  const counts = rows.reduce<Record<string, number>>((c, r) => ({ ...c, [r.status]: (c[r.status] || 0) + 1 }), {});
  return json({ counts, deliveries: rows.map((r) => ({ ...r, ref: orderRef(r.order_id) })) });
};

export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.ADMIN_TOKEN) return notConfigured('Admin deliveries');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const b = await body<{ order_id?: string; resend?: boolean }>(request).catch(() => null);
  if (!b?.order_id || !/^pi_[A-Za-z0-9]+$/.test(b.order_id)) return fail(400, 'order_id (a pi_… id) is required.');
  if (b.resend) await env.DB.prepare("UPDATE rr_deliveries SET status = 'failed', updated_at = ? WHERE order_id = ? AND status = 'sent'").bind(new Date().toISOString(), b.order_id).run();
  return json({ result: await deliverOrder(env, b.order_id) });
};
