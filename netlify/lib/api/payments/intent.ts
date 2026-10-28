import { body, fail, getSession, isProduct, json, notConfigured, ownedProducts, PRICES, purchaseAllowed, stripe, type Ctx } from '../../_lib';

/** The book ships (alone, or in the Bundle): Stripe's Address Element attaches the shipping address to the PaymentIntent. */
const DESCRIPTIONS = {
  creditready: 'RentReady Digital Bundle — Before They Say No (physical book) + 20 dispute letter templates + video guide',
  guide: 'RentReady — Before They Say No (physical book)',
  upgrade: 'RentReady Digital Bundle upgrade — dispute letter templates + video guide (book purchase credited; nothing ships)',
} as const;

/** POST /api/payments/intent — createPaymentIntent(). Amount is decided HERE, never by the client. */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_SECRET_KEY || !env.SESSION_SECRET) return notConfigured('Payments');
  const s = await getSession(request, env);
  if (!s?.customer_id) return fail(401, 'Your session expired. Reload checkout.', 'no_session');
  const b = await body<{ product?: string }>(request);
  // Front-door products only; the Playbook is sold through /api/upsell/charge.
  if (!isProduct(b.product) || !(b.product in DESCRIPTIONS)) return fail(400, 'Unknown product.');
  const product = b.product as keyof typeof DESCRIPTIONS;
  // Never sell something already owned; the upgrade price is only for book owners.
  if (env.DB && !purchaseAllowed(product, await ownedProducts(env, s.customer_id))) {
    return fail(409, product === 'upgrade' ? 'The upgrade is for people who already bought the book.' : 'You already own this — open your access page.', 'already_owned');
  }
  const pi = await stripe<{ id: string; client_secret: string; amount: number }>(
    env,
    'POST',
    'payment_intents',
    {
      amount: String(PRICES[product]),
      currency: 'usd',
      customer: s.customer_id,
      // Only Bundle purchases (full or upgrade) lead to the one-click upsell, so only they save the PaymentMethod.
      ...(product !== 'guide' ? { setup_future_usage: 'off_session' } : {}),
      'automatic_payment_methods[enabled]': 'true',
      'metadata[product]': product,
      'metadata[lead_id]': s.lead_id,
      description: DESCRIPTIONS[product],
    },
    request.headers.get('Idempotency-Key') || undefined,
  );
  return json({ payment_intent_id: pi.id, client_secret: pi.client_secret, amount_cents: pi.amount });
};
