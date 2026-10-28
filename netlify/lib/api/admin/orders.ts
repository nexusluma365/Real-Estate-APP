import { bearerOk, body, fail, json, notConfigured, recordLifecycle, stripe, type Ctx } from '../../_lib';

/**
 * Book fulfilment for /admin (Authorization: Bearer ADMIN_TOKEN).
 * GET  /api/admin/orders — orders that ship a book (last 120 days), newest first, with the Stripe shipping
 *      address for orders not yet shipped.
 * POST /api/admin/orders { payment_intent_id, carrier?, tracking?, tracking_url? } — marks one shipped and emails
 *      the customer once (lifecycle `order_shipped`, ref = PaymentIntent id).
 */
interface Row { payment_intent_id: string; product: string; amount_cents: number; created_at: string; refunded_at: string | null; email: string | null; first_name: string | null; lead_id: string | null; shipped: string | null }
interface Shipping { name?: string; address?: { line1?: string; line2?: string; city?: string; state?: string; postal_code?: string; country?: string } }

export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.ADMIN_TOKEN) return notConfigured('Admin orders');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const rows = (await env.DB.prepare(
    `SELECT o.payment_intent_id, o.product, o.amount_cents, o.created_at, o.refunded_at, l.email, l.first_name, l.lead_id,
            (SELECT e.data FROM rr_lifecycle_events e WHERE e.lead_id = o.lead_id AND e.event = 'order_shipped' AND e.ref = o.payment_intent_id) AS shipped
       FROM rr_orders o LEFT JOIN rr_leads l ON l.lead_id = o.lead_id
      WHERE o.product IN ('guide', 'creditready') AND o.created_at >= ?
      ORDER BY o.created_at DESC LIMIT 200`,
  ).bind(since).all<Row>()).results;

  const orders = await Promise.all(rows.map(async (r, i) => {
    let shipping: Shipping | null = null;
    // Addresses live in Stripe (collected by the Address Element); fetch them only for what still needs shipping.
    if (!r.shipped && !r.refunded_at && env.STRIPE_SECRET_KEY && i < 60) {
      shipping = await stripe<{ shipping?: Shipping | null }>(env, 'GET', `payment_intents/${r.payment_intent_id}`).then((pi) => pi.shipping || null).catch(() => null);
    }
    return { ...r, shipped: r.shipped ? JSON.parse(r.shipped) : null, shipping };
  }));
  return json({ orders });
};

export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.ADMIN_TOKEN) return notConfigured('Admin orders');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const b = await body<{ payment_intent_id?: string; carrier?: string; tracking?: string; tracking_url?: string }>(request).catch(() => null);
  if (!b?.payment_intent_id) return fail(400, 'payment_intent_id is required.');
  const order = await env.DB.prepare("SELECT lead_id FROM rr_orders WHERE payment_intent_id = ? AND product IN ('guide', 'creditready')")
    .bind(b.payment_intent_id).first<{ lead_id: string | null }>();
  if (!order?.lead_id) return fail(404, 'No shippable order with that id.');
  const trackingUrl = String(b.tracking_url || '').trim();
  if (trackingUrl && !/^https:\/\//.test(trackingUrl)) return fail(422, 'The tracking link must start with https://');
  const data = {
    carrier: String(b.carrier || '').trim().slice(0, 40) || undefined,
    tracking: String(b.tracking || '').trim().slice(0, 80) || undefined,
    tracking_url: trackingUrl.slice(0, 300) || undefined,
    at: new Date().toISOString(),
  };
  const created = await recordLifecycle(env, order.lead_id, 'order_shipped', data, b.payment_intent_id);
  return json({ ok: true, already_shipped: !created });
};
