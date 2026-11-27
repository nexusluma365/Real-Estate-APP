import { body, chargeCents, cleanAffiliate, fail, getSession, isProduct, json, notConfigured, ownedProducts, purchaseAllowed, stripe, type Ctx } from '../../_lib';

/** The two products for sale. Both are digital: nothing ships, no address is collected. */
const DESCRIPTIONS = {
  creditready: 'RentReady Complete Digital Bundle — Know Before They Say NO! eBook + 20 dispute letter templates + video guides',
  guide: 'RentReady Digital eBook — Know Before They Say NO!',
} as const;

/** POST /api/payments/intent — createPaymentIntent(). Amount is decided HERE, never by the client. */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_SECRET_KEY || !env.SESSION_SECRET) return notConfigured('Payments');
  const s = await getSession(request, env);
  if (!s?.customer_id) return fail(401, 'Your session expired. Reload checkout.', 'no_session');
  const b = await body<{ product?: string; affiliate?: string }>(request);
  // Only the two digital products; the retired upgrade and Playbook can't be bought here (or anywhere).
  if (!isProduct(b.product) || !(b.product in DESCRIPTIONS)) return fail(400, 'This product is not available.', 'unavailable');
  const product = b.product as keyof typeof DESCRIPTIONS;
  if (env.DB && !purchaseAllowed(product, await ownedProducts(env, s.customer_id))) {
    return fail(409, 'You already own this — open your access page.', 'already_owned');
  }
  // Affiliate who referred this buyer: from this browser's latest affiliate link (src/lib/attribution.ts), else the one
  // stored on the lead. Only an id is accepted — it's used for reporting, never to change the price.
  const fromLink = cleanAffiliate(b.affiliate);
  if (fromLink && env.DB) await env.DB.prepare('UPDATE rr_leads SET affiliate = ? WHERE lead_id = ?').bind(fromLink, s.lead_id).run().catch(() => undefined);
  const affiliate = fromLink || (env.DB
    ? cleanAffiliate((await env.DB.prepare('SELECT affiliate FROM rr_leads WHERE lead_id = ?').bind(s.lead_id).first<{ affiliate: string | null }>().catch(() => null))?.affiliate)
    : null);
  const pi = await stripe<{ id: string; client_secret: string; amount: number }>(
    env,
    'POST',
    'payment_intents',
    {
      amount: String(chargeCents(product)),
      currency: 'usd',
      customer: s.customer_id,
      'automatic_payment_methods[enabled]': 'true',
      'metadata[product]': product,
      'metadata[lead_id]': s.lead_id,
      'metadata[fulfillment]': 'digital',
      ...(affiliate ? { 'metadata[affiliate]': affiliate } : {}),
      description: DESCRIPTIONS[product],
    },
    request.headers.get('Idempotency-Key') || undefined,
  );
  return json({ payment_intent_id: pi.id, client_secret: pi.client_secret, amount_cents: pi.amount });
};
