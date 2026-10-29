import { grantEntitlement, isProduct, json, notConfigured, PRICES, recordLifecycle, verifyStripeSignature, type Ctx, type Env } from '../../_lib';
import { activateFromCheckout, leadForCustomer, upsertSubscription, type StripeSub } from '../../premium';

/**
 * POST /api/webhooks/stripe — source of truth for entitlements, purchase emails and refunds.
 * Configure in Stripe Dashboard → Webhooks: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded,
 * and for RentReady Premium: checkout.session.completed, customer.subscription.created / .updated / .deleted,
 * invoice.paid, invoice.payment_failed.
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
  invoice?: string | null;
  last_payment_error?: { code?: string; decline_code?: string };
}
interface Invoice {
  id: string; customer: string; amount_paid: number; amount_due: number; billing_reason: string | null; hosted_invoice_url?: string | null;
  subscription?: string | null; parent?: { subscription_details?: { subscription?: string } }; next_payment_attempt?: number | null; attempt_count?: number;
}
const invoiceSub = (i: Invoice) => i.subscription || i.parent?.subscription_details?.subscription || null;

async function premiumEvent(env: Env, type: string, obj: unknown) {
  const DB = env.DB!;
  if (type === 'checkout.session.completed') {
    const cs = obj as { id: string; mode: string };
    if (cs.mode === 'subscription') await activateFromCheckout(env, cs.id);
    return;
  }
  if (type.startsWith('customer.subscription.')) {
    const sub = obj as StripeSub;
    const prev = await upsertSubscription(env, sub, await leadForCustomer(env, sub.customer));
    const leadId = await leadForCustomer(env, sub.customer);
    if (!leadId) return;
    const row = await DB.prepare('SELECT current_period_end FROM rr_subscriptions WHERE subscription_id = ?').bind(sub.id).first<{ current_period_end: string | null }>();
    if (sub.cancel_at_period_end && !prev?.cancel_at_period_end) {
      await recordLifecycle(env, leadId, 'premium_cancel_scheduled', { subscription_id: sub.id, access_until: row?.current_period_end }, `${sub.id}:${row?.current_period_end}`);
    }
    if (type === 'customer.subscription.deleted' || (sub.status === 'canceled' && prev?.status !== 'canceled')) {
      await recordLifecycle(env, leadId, 'premium_ended', { subscription_id: sub.id }, sub.id);
    }
    return;
  }
  if (type === 'invoice.paid' || type === 'invoice.payment_failed') {
    const inv = obj as Invoice;
    const subId = invoiceSub(inv);
    if (!subId) return;
    const paid = type === 'invoice.paid';
    await DB.prepare(
      `INSERT INTO rr_premium_invoices (invoice_id, subscription_id, customer_id, amount_cents, billing_reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(invoice_id) DO UPDATE SET status = excluded.status, amount_cents = excluded.amount_cents`,
    ).bind(inv.id, subId, inv.customer, paid ? inv.amount_paid : inv.amount_due, inv.billing_reason, paid ? 'paid' : 'failed', new Date().toISOString()).run();
    const leadId = await leadForCustomer(env, inv.customer);
    if (!leadId) return;
    if (paid && inv.billing_reason === 'subscription_cycle') {
      await recordLifecycle(env, leadId, 'premium_renewed', { amount_cents: inv.amount_paid, invoice_id: inv.id }, inv.id);
    }
    if (!paid) {
      // One notice per failed attempt; the link is Stripe's hosted invoice page (pay or update the card securely).
      await recordLifecycle(env, leadId, 'premium_payment_failed', {
        amount_cents: inv.amount_due, pay_url: inv.hosted_invoice_url || null,
        next_attempt: inv.next_payment_attempt ? new Date(inv.next_payment_attempt * 1000).toISOString() : null,
      }, `${inv.id}:${inv.attempt_count ?? 1}`);
    }
  }
}

export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_WEBHOOK_SECRET || !env.DB) return notConfigured('Webhooks');
  const payload = await request.text();
  if (!(await verifyStripeSignature(payload, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET))) {
    return new Response('Invalid signature', { status: 400 });
  }
  const event = JSON.parse(payload) as { id: string; type: string; data: { object: StripeObj } };
  // Idempotency: store processed event ids
  const seen = await env.DB.prepare('SELECT id FROM rr_webhook_events WHERE id = ?').bind(event.id).first();
  if (seen) return json({ received: true, duplicate: true });
  await env.DB.prepare('INSERT INTO rr_webhook_events (id, type, received_at) VALUES (?, ?, ?)').bind(event.id, event.type, new Date().toISOString()).run();

  if (/^(checkout\.session\.completed|customer\.subscription\.|invoice\.(paid|payment_failed))/.test(event.type)) {
    await premiumEvent(env, event.type, event.data.object);
    return json({ received: true });
  }
  const o = event.data.object;
  const leadId = o.metadata?.lead_id;
  if (event.type === 'payment_intent.succeeded') {
    const product = o.metadata.product;
    if (isProduct(product) && o.amount === PRICES[product] && o.currency === 'usd') {
      await grantEntitlement(env, o.customer, product, o.id, o.amount, leadId);
      // One confirmation per PaymentIntent (ref = pi id) → receipt (Resend) + ESP and stops recovery flows.
      if (leadId) await recordLifecycle(env, leadId, 'purchase_completed', { product, amount_cents: o.amount, order_id: o.id, customer_id: o.customer }, o.id);
      // INTEGRATE: server-side Google Ads conversion upload / Meta Conversions API (event_id = o.id) here.
    }
  }
  if (event.type === 'payment_intent.payment_failed' && leadId) {
    await recordLifecycle(env, leadId, 'payment_failed', { product: o.metadata.product, reason: o.last_payment_error?.decline_code || o.last_payment_error?.code }, o.id);
  }
  if (event.type === 'charge.refunded' && o.invoice) {
    // Membership refunds are recorded; access follows the subscription (cancel it in Stripe to end access).
    await env.DB.prepare('UPDATE rr_premium_invoices SET refunded_cents = ? WHERE invoice_id = ?').bind(o.amount_refunded ?? o.amount, o.invoice).run();
    return json({ received: true });
  }
  if (event.type === 'charge.refunded' && o.payment_intent) {
    const order = await env.DB.prepare('SELECT product, lead_id, amount_cents FROM rr_orders WHERE payment_intent_id = ?').bind(o.payment_intent)
      .first<{ product: string; lead_id: string | null; amount_cents: number }>();
    const full = o.refunded === true || (o.amount_refunded ?? 0) >= o.amount;
    await env.DB.prepare('UPDATE rr_orders SET refunded_cents = ?, refunded_at = ? WHERE payment_intent_id = ?').bind(o.amount_refunded ?? o.amount, new Date().toISOString(), o.payment_intent).run();
    // Full refunds revoke access to what that order granted (an upgrade order granted the Bundle). Partial refunds don't.
    if (full && order) {
      const granted = order.product === 'upgrade' ? 'creditready' : order.product;
      await env.DB.prepare('UPDATE rr_entitlements SET revoked_at = ? WHERE customer_id = ? AND product = ?').bind(new Date().toISOString(), o.customer, granted).run();
    }
    if (order?.lead_id) await recordLifecycle(env, order.lead_id, 'refund_processed', { product: order.product, full, amount_refunded: o.amount_refunded }, o.payment_intent);
  }
  return json({ received: true });
};
