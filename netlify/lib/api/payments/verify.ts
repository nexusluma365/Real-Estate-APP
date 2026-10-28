import { body, fail, getSession, grantEntitlement, isProduct, json, notConfigured, ownedProducts, PRICES, stripe, type Ctx } from '../../_lib';

/**
 * POST /api/payments/verify — verifyPaymentServerSide().
 * Retrieves the PaymentIntent with the secret key and checks status, amount, currency
 * and customer before granting. The webhook does the same independently.
 */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_SECRET_KEY || !env.SESSION_SECRET || !env.DB) return notConfigured('Payments');
  const s = await getSession(request, env);
  if (!s?.customer_id) return fail(401, 'Session expired.', 'no_session');
  const b = await body<{ payment_intent_id?: string; product?: string }>(request);
  if (!b.payment_intent_id || !/^pi_[A-Za-z0-9]+$/.test(b.payment_intent_id) || !isProduct(b.product)) return fail(400, 'Invalid request.');
  const pi = await stripe<{ id: string; status: string; amount: number; currency: string; customer: string; metadata: { product?: string } }>(env, 'GET', `payment_intents/${b.payment_intent_id}`);
  const valid = pi.status === 'succeeded' && pi.customer === s.customer_id && pi.currency === 'usd' && pi.amount === PRICES[b.product] && pi.metadata.product === b.product;
  if (!valid) return json({ verified: false, products: await ownedProducts(env, s.customer_id) });
  await grantEntitlement(env, s.customer_id, b.product, pi.id, pi.amount, s.lead_id);
  return json({
    verified: true,
    order: { order_id: pi.id, product: b.product, amount_cents: pi.amount, payment_intent_id: pi.id, created_at: new Date().toISOString() },
    products: await ownedProducts(env, s.customer_id),
  });
};
