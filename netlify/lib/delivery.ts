import { isProduct, type Env, type ProductId } from './_lib';
import { packageEmail, siteOrigin } from './email';

/**
 * Digital delivery. After Stripe confirms a payment (webhook), deliverOrder() emails the buyer their package: what they
 * bought and a sign-in link to /access, where every file is served through a 1-minute signed URL (netlify/lib/api/files.ts).
 * No file or file URL is ever put in an email.
 *
 * - Exactly once: rr_deliveries is keyed by the order (PaymentIntent) id; a 'sent' row is never sent again, so Stripe
 *   retrying a webhook can't double-deliver.
 * - Logged: status, attempts and the last error per order, for support (GET /api/admin/deliveries).
 * - Retried: failed sends are retried by the scheduled function netlify/functions/delivery-retry.mts with growing gaps
 *   (2, 4, 8 … minutes) for up to MAX_ATTEMPTS, and it also catches paid orders whose delivery never started.
 * - Never blocks access: the buyer lands on /welcome (and /access) signed in right after checkout, email or not, and can
 *   request a fresh sign-in link on /access at any time.
 */
export const PACKAGE_LINK_DAYS = 7;
export const MAX_ATTEMPTS = 8;
const RETRY_WINDOW_MS = 3 * 86400000;

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Creates a sign-in link for a lead (GET /api/access/verify?token=…). Only a hash of the token is stored.
 * Package links are reusable until they expire (the buyer may open the email on two devices); requested sign-in links
 * work once.
 */
export async function issueAccessLink(env: Env, leadId: string, o: { ttlMs: number; reusable: boolean; next?: string }) {
  const raw = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const hash = await sha256(raw);
  await env.DB!.prepare('INSERT INTO rr_access_tokens (token_hash, lead_id, expires_at, reusable) VALUES (?, ?, ?, ?)')
    .bind(hash, leadId, new Date(Date.now() + o.ttlMs).toISOString(), o.reusable ? 1 : 0).run();
  return { link: `${siteOrigin(env)}/api/access/verify?token=${raw}${o.next ? `&next=${encodeURIComponent(o.next)}` : ''}`, hash };
}

type Outcome = 'sent' | 'already_sent' | 'skipped' | 'failed';

/** Sends one order's package email unless it was already sent. Safe to call any number of times. */
export async function deliverOrder(env: Env, orderId: string): Promise<Outcome> {
  const DB = env.DB!;
  const order = await DB.prepare(
    `SELECT o.payment_intent_id, o.product, o.amount_cents, o.refunded_at, o.lead_id, l.email, l.first_name
       FROM rr_orders o LEFT JOIN rr_leads l ON l.lead_id = o.lead_id WHERE o.payment_intent_id = ?`,
  ).bind(orderId).first<{ payment_intent_id: string; product: string; amount_cents: number; refunded_at: string | null; lead_id: string | null; email: string | null; first_name: string | null }>();
  if (!order || !isProduct(order.product)) return 'skipped';
  const now = new Date().toISOString();
  const prior = await DB.prepare('SELECT status, attempts FROM rr_deliveries WHERE order_id = ?').bind(orderId).first<{ status: string; attempts: number }>();
  if (prior?.status === 'sent') return 'already_sent';
  if (!prior) {
    await DB.prepare("INSERT INTO rr_deliveries (order_id, lead_id, product, status, attempts, created_at, updated_at) VALUES (?, ?, ?, 'pending', 0, ?, ?) ON CONFLICT DO NOTHING")
      .bind(orderId, order.lead_id || '', order.product, now, now).run();
  }
  const mark = (status: string, error: string | null) =>
    DB.prepare(`UPDATE rr_deliveries SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ?${status === 'sent' ? ', sent_at = ?' : ''} WHERE order_id = ?`)
      .bind(...(status === 'sent' ? [status, error, now, now, orderId] : [status, error, now, orderId])).run();
  if (order.refunded_at) {
    await DB.prepare("UPDATE rr_deliveries SET status = 'skipped', last_error = 'refunded', updated_at = ? WHERE order_id = ?").bind(now, orderId).run();
    return 'skipped';
  }
  if (!order.lead_id || !order.email) {
    await mark('failed', 'no email address on the order');
    return 'failed';
  }
  try {
    const { link } = await issueAccessLink(env, order.lead_id, { ttlMs: PACKAGE_LINK_DAYS * 86400000, reusable: true, next: '/access' });
    const sent = await packageEmail(env, { email: order.email, first_name: order.first_name || '' }, {
      product: order.product as ProductId, amount_cents: order.amount_cents, order_id: orderId, access_link: link, link_days: PACKAGE_LINK_DAYS,
    });
    if (!sent) throw new Error('email not configured (RESEND_API_KEY / FROM_EMAIL)');
    await mark('sent', null);
    return 'sent';
  } catch (e) {
    const attempts = (prior?.attempts ?? 0) + 1;
    await mark(attempts >= MAX_ATTEMPTS ? 'gave_up' : 'failed', (e instanceof Error ? e.message : String(e)).slice(0, 300));
    console.error('delivery failed', orderId, e);
    return 'failed';
  }
}

/**
 * Scheduled retry (every 10 minutes): failed deliveries whose back-off has passed, plus recent paid digital orders that
 * have no delivery row at all (e.g. the webhook crashed after recording the order). Refunded orders are skipped.
 */
export async function retryDeliveries(env: Env, nowMs = Date.now()) {
  const DB = env.DB!;
  const since = new Date(nowMs - RETRY_WINDOW_MS).toISOString();
  const due = (await DB.prepare("SELECT order_id, attempts, updated_at FROM rr_deliveries WHERE status IN ('failed', 'pending') AND created_at >= ? ORDER BY created_at LIMIT 50")
    .bind(since).all<{ order_id: string; attempts: number; updated_at: string }>()).results
    .filter((d) => nowMs - Date.parse(d.updated_at) >= 2 ** Math.max(1, d.attempts) * 60000);
  const missing = (await DB.prepare(
    `SELECT o.payment_intent_id AS order_id FROM rr_orders o LEFT JOIN rr_deliveries d ON d.order_id = o.payment_intent_id
      WHERE d.order_id IS NULL AND o.fulfillment = 'digital' AND o.refunded_at IS NULL AND o.created_at >= ? AND o.created_at <= ? LIMIT 50`,
  ).bind(since, new Date(nowMs - 5 * 60000).toISOString()).all<{ order_id: string }>()).results;
  const out = { tried: 0, sent: 0, failed: 0 };
  for (const { order_id } of [...due, ...missing]) {
    out.tried++;
    const r = await deliverOrder(env, order_id);
    if (r === 'sent') out.sent++;
    else if (r === 'failed') out.failed++;
  }
  return out;
}
