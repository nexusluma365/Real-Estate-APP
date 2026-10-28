import { fail, getSession, json, notConfigured, ownedProducts, PRICES, stripe, type Ctx } from '../../_lib';

/**
 * POST /api/upsell/charge — the ONLY server path that charges the saved card.
 * Called solely from the explicit "Yes — add the Playbook" click. Off-session PaymentIntent
 * on the PaymentMethod the customer authorised at checkout. Idempotency-Key prevents double charges.
 */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_SECRET_KEY || !env.SESSION_SECRET || !env.DB) return notConfigured('Payments');
  const s = await getSession(request, env);
  if (!s?.customer_id) return fail(401, 'Session expired.', 'no_session');
  const owned = await ownedProducts(env, s.customer_id);
  if (!owned.includes('creditready')) return fail(403, 'Not eligible for this offer.');
  if (owned.includes('playbook')) return json({ status: 'succeeded', payment_intent_id: 'already_owned' });
  const row = await env.DB.prepare('SELECT upsell_payment_method FROM leads WHERE lead_id = ?').bind(s.lead_id).first<{ upsell_payment_method: string | null }>();
  if (!row?.upsell_payment_method) return json({ status: 'error', message: 'No saved payment method is available. You have not been charged.' });
  try {
    const pi = await stripe<{ id: string; status: string; client_secret: string }>(
      env,
      'POST',
      'payment_intents',
      {
        amount: String(PRICES.playbook),
        currency: 'usd',
        customer: s.customer_id,
        payment_method: row.upsell_payment_method,
        off_session: 'true',
        confirm: 'true',
        'metadata[product]': 'playbook',
        'metadata[lead_id]': s.lead_id,
        description: 'RentReady — Property Manager Playbook',
      },
      request.headers.get('Idempotency-Key') || undefined,
    );
    if (pi.status === 'succeeded') return json({ status: 'succeeded', payment_intent_id: pi.id });
    if (pi.status === 'requires_action') return json({ status: 'requires_action', payment_intent_id: pi.id, client_secret: pi.client_secret });
    return json({ status: 'declined', message: 'Your saved card was declined. You still have full access to your Digital Bundle.' });
  } catch (e) {
    const err = (e as { stripe?: { code?: string; payment_intent?: { id: string; client_secret: string } } }).stripe;
    if (err?.code === 'authentication_required' && err.payment_intent) {
      return json({ status: 'requires_action', payment_intent_id: err.payment_intent.id, client_secret: err.payment_intent.client_secret });
    }
    if (err?.code === 'card_declined') return json({ status: 'declined', message: 'Your saved card was declined. You still have full access to your Digital Bundle.' });
    return json({ status: 'error', message: 'We couldn’t complete that request. You have not been charged.' });
  }
};
