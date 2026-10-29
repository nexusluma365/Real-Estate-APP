import { body, fail, getSession, json, notConfigured, stripe, type Ctx } from '../../_lib';
import { PREMIUM, premiumStatus, safeReturn } from '../../premium';

/**
 * POST /api/premium/checkout { return_to } — starts Stripe-hosted subscription checkout.
 * $5 for the first month (a once-only $14.99 coupon on the $19.99/month price) — first membership only.
 * Stripe Checkout shows the full terms ("$5.00 today, then $19.99/month") before the customer pays.
 */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_SECRET_KEY || !env.SESSION_SECRET || !env.DB) return notConfigured('Membership checkout');
  const b = await body<{ return_to?: string }>(request).catch(() => ({} as { return_to?: string }));
  const origin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  const back = safeReturn(b.return_to);
  const s = await getSession(request, env);
  const status = await premiumStatus(env, s?.customer_id, s?.lead_id);
  if (status.active) return fail(409, 'Your RentReady Premium membership is already active.', 'already_member');

  const prices = await stripe<{ data: { id: string; unit_amount: number; recurring?: { interval: string } }[] }>(env, 'GET', 'prices', { 'lookup_keys[]': PREMIUM.priceLookupKey, active: 'true' });
  const price = prices.data.find((p) => p.unit_amount === PREMIUM.priceCents && p.recurring?.interval === 'month');
  if (!price) return fail(501, 'Membership pricing is not set up yet.', 'not_configured');
  const intro = !status.had_premium;

  const lead = s ? await env.DB.prepare('SELECT email, stripe_customer_id FROM rr_leads WHERE lead_id = ?').bind(s.lead_id).first<{ email: string; stripe_customer_id: string | null }>() : null;
  const params: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': price.id,
    'line_items[0][quantity]': '1',
    success_url: `${origin}/api/premium/return?session_id={CHECKOUT_SESSION_ID}&to=${encodeURIComponent(back)}`,
    cancel_url: `${origin}${back}${back.includes('?') ? '&' : '?'}premium=canceled`,
    'custom_text[submit][message]': intro
      ? 'You’ll pay $5.00 today for your first month, then $19.99 every month until you cancel. Cancel any time from your RentReady account.'
      : 'You’ll pay $19.99 today and every month until you cancel. Cancel any time from your RentReady account.',
    'subscription_data[description]': 'RentReady Premium',
  };
  if (intro) params['discounts[0][coupon]'] = PREMIUM.introCouponId;
  if (s?.lead_id) {
    params['metadata[lead_id]'] = s.lead_id;
    params['subscription_data[metadata][lead_id]'] = s.lead_id;
    params.client_reference_id = s.lead_id;
  }
  if (lead?.stripe_customer_id) params.customer = lead.stripe_customer_id;
  else if (lead?.email) params.customer_email = lead.email;

  const cs = await stripe<{ id: string; url: string }>(env, 'POST', 'checkout/sessions', params);
  return json({ url: cs.url, intro, price_cents: PREMIUM.priceCents, intro_cents: intro ? PREMIUM.introCents : PREMIUM.priceCents });
};
