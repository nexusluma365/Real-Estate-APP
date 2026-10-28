import { body, fail, getSession, json, notConfigured, stripe, type Ctx } from '../../_lib';

/**
 * POST /api/payments/save-method — savePaymentMethodForUpsell().
 * setup_future_usage already attached the PaymentMethod to the Customer; here we record it as the
 * method the customer authorised for the one-click offer (with the consent text shown at checkout).
 */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_SECRET_KEY || !env.SESSION_SECRET || !env.DB) return notConfigured('Payments');
  const s = await getSession(request, env);
  if (!s?.customer_id) return fail(401, 'Session expired.', 'no_session');
  const b = await body<{ payment_intent_id?: string }>(request);
  const pi = await stripe<{ customer: string; payment_method: string; status: string }>(env, 'GET', `payment_intents/${b.payment_intent_id}`);
  if (pi.customer !== s.customer_id || pi.status !== 'succeeded') return fail(400, 'Payment not eligible.');
  await env.DB.prepare('UPDATE leads SET upsell_payment_method = ?, upsell_consent_at = ? WHERE lead_id = ?').bind(pi.payment_method, new Date().toISOString(), s.lead_id).run();
  return json({ saved: true });
};
