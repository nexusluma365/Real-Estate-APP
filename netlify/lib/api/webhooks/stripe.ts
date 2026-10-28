import { grantEntitlement, isProduct, json, notConfigured, PRICES, recordLifecycle, verifyStripeSignature, type Ctx } from '../../_lib';

/**
 * POST /api/webhooks/stripe — source of truth for entitlements, purchase emails and refunds.
 * Configure in Stripe Dashboard → Webhooks: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded.
 */
interface StripeObj {
  id: string;
  customer: string;
  amount: number;
  amount_refunded?: number;
  refunded?: boolean;
  currency: string;
  metadata: { product?: string; lead_id?: string };
  payment_intent?: string;
  last_payment_error?: { code?: string; decline_code?: string };
}

export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.DB) return notConfigured('Webhooks');
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('Invalid signature', { status: 400 });
  }
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: StripeObj } };
  // Idempotency: store processed event ids
  const seen = await env.DB.prepare('SELECT id FROM webhook_events WHERE id = ?').bind(event.id).first();
  if (seen) return json({ received: true, duplicate: true });
  await env.DB.prepare('INSERT INTO webhook_events (id, type, received_at) VALUES (?, ?, ?)').bind(event.id, event.type, new Date().toISOString()).run();

  const o = event.data.object;
  const leadId = o.metadata?.lead_id;
  if (event.type === 'payment_intent.succeeded') {
    const product = o.metadata.product;
    if (isProduct(product) && o.amount === PRICES[product] && o.currency === 'usd') {
      await grantEntitlement(env, o.customer, product, o.id, o.amount, leadId);
      // One confirmation per PaymentIntent (ref = pi id) → ESP sends receipt + access link and stops recovery flows.
      if (leadId) await recordLifecycle(env, leadId, 'purchase_completed', { product, amount_cents: o.amount, order_id: o.id }, o.id);
      // INTEGRATE: server-side Google Ads conversion upload / Meta Conversions API (event_id = o.id) here.
    }
  }
  if (event.type === 'payment_intent.payment_failed' && leadId) {
    await recordLifecycle(env, leadId, 'payment_failed', { product: o.metadata.product, reason: o.last_payment_error?.decline_code || o.last_payment_error?.code }, o.id);
  }
  if (event.type === 'charge.refunded' && o.payment_intent) {
    const order = await env.DB.prepare('SELECT product, lead_id, amount_cents FROM orders WHERE payment_intent_id = ?').bind(o.payment_intent)
      .first<{ product: string; lead_id: string | null; amount_cents: number }>();
    const full = o.refunded === true || (o.amount_refunded ?? 0) >= o.amount;
    await env.DB.prepare('UPDATE orders SET refunded_cents = ?, refunded_at = ? WHERE payment_intent_id = ?').bind(o.amount_refunded ?? o.amount, new Date().toISOString(), o.payment_intent).run();
    // Full refunds revoke access to what that order granted (an upgrade order granted the Bundle). Partial refunds don't.
    if (full && order) {
      const granted = order.product === 'upgrade' ? 'creditready' : order.product;
      await env.DB.prepare('UPDATE entitlements SET revoked_at = ? WHERE customer_id = ? AND product = ?').bind(new Date().toISOString(), o.customer, granted).run();
    }
    if (order?.lead_id) await recordLifecycle(env, order.lead_id, 'refund_processed', { product: order.product, full, amount_refunded: o.amount_refunded }, o.payment_intent);
  }
  return json({ received: true });
};
