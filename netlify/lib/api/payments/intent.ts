import { body, chargeCents, cleanAffiliate, fail, getSession, isProduct, json, notConfigured, ownedProducts, purchaseAllowed, setSession, stripe, type Ctx } from '../../_lib';

type StripeErr = { type?: string; code?: string; param?: string; message?: string } | undefined;
const stripeErr = (e: unknown): StripeErr => (e as { stripe?: StripeErr }).stripe;

/**
 * The browser's Idempotency-Key (one per checkout attempt) is combined with a fingerprint of the exact request, so a
 * double-click never creates two payments, but a key first used for a different order (an old price, another product)
 * can never collide — Stripe rejects a reused key whose parameters changed.
 */
async function idempotencyKey(clientKey: string | null, params: Record<string, string>) {
  if (!clientKey) return undefined;
  const canon = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canon)));
  return `${clientKey.replace(/[^\w-]/g, '').slice(0, 64)}-${[...h.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

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
  const params: Record<string, string> = {
    amount: String(chargeCents(product)),
    currency: 'usd',
    customer: s.customer_id,
    'automatic_payment_methods[enabled]': 'true',
    'metadata[product]': product,
    'metadata[lead_id]': s.lead_id,
    'metadata[fulfillment]': 'digital',
    ...(affiliate ? { 'metadata[affiliate]': affiliate } : {}),
    description: DESCRIPTIONS[product],
  };
  const create = async (p: Record<string, string>, key?: string) => stripe<{ id: string; client_secret: string; amount: number }>(env, 'POST', 'payment_intents', p, key);
  let pi: { id: string; client_secret: string; amount: number };
  let cookie: string | undefined;
  try {
    pi = await create(params, await idempotencyKey(request.headers.get('Idempotency-Key'), params));
  } catch (e) {
    const se = stripeErr(e);
    try {
      if (se?.type === 'idempotency_error') {
        // Belt and braces: a key Stripe still considers taken → one fresh attempt without it.
        pi = await create(params);
      } else if (se?.code === 'resource_missing' && se.param === 'customer' && env.DB) {
        // The saved Stripe customer doesn't exist for this account/mode (e.g. created with test keys). Make a new one.
        const lead = await env.DB.prepare('SELECT email, first_name FROM rr_leads WHERE lead_id = ?').bind(s.lead_id).first<{ email: string; first_name: string }>();
        if (!lead) throw e;
        const c = await stripe<{ id: string }>(env, 'POST', 'customers', { email: lead.email, name: lead.first_name, 'metadata[lead_id]': s.lead_id });
        await env.DB.prepare('UPDATE rr_leads SET stripe_customer_id = ? WHERE lead_id = ?').bind(c.id, s.lead_id).run();
        cookie = await setSession(env, { lead_id: s.lead_id, customer_id: c.id });
        pi = await create({ ...params, customer: c.id });
      } else throw e;
    } catch (e2) {
      const err = stripeErr(e2) || se;
      console.error('payment intent failed', { type: err?.type, code: err?.code, param: err?.param, message: err?.message || (e2 instanceof Error ? e2.message : String(e2)) });
      // Safe to show: Stripe's error type/code (never keys or card data), so a failure can be diagnosed from the browser.
      return fail(502, 'We couldn’t start the secure payment. Please try again, or email support if it keeps happening.', `stripe_${err?.code || err?.type || 'error'}`);
    }
  }
  return json({ payment_intent_id: pi.id, client_secret: pi.client_secret, amount_cents: pi.amount }, 200, cookie ? { 'Set-Cookie': cookie } : {});
};
