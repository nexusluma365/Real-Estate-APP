import { bearerOk, fail, json, notConfigured, stripe, type Ctx } from '../../_lib';
import { PREMIUM } from '../../premium';

/**
 * POST /api/admin/premium-setup (Authorization: Bearer ADMIN_TOKEN) — one-time, idempotent Stripe catalog setup:
 * the RentReady Premium product + $19.99/month price (lookup key), the once-only $14.99-off intro coupon ($5 first
 * month) and a customer-portal configuration (update card, invoices, cancel at period end). Safe to run again.
 */
export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.STRIPE_SECRET_KEY || !env.ADMIN_TOKEN) return notConfigured('Premium setup');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const origin = env.ALLOWED_ORIGIN || new URL(request.url).origin;
  const out: Record<string, string> = {};

  const prices = await stripe<{ data: { id: string; unit_amount: number }[] }>(env, 'GET', 'prices', { 'lookup_keys[]': PREMIUM.priceLookupKey, active: 'true' });
  let price = prices.data.find((p) => p.unit_amount === PREMIUM.priceCents);
  if (!price) {
    price = await stripe<{ id: string; unit_amount: number }>(env, 'POST', 'prices', {
      currency: 'usd', unit_amount: String(PREMIUM.priceCents), 'recurring[interval]': 'month', lookup_key: PREMIUM.priceLookupKey, transfer_lookup_key: 'true',
      'product_data[name]': 'RentReady Premium', 'product_data[statement_descriptor]': 'RENTREADY PREMIUM',
    }, `rr-premium-price-${PREMIUM.priceCents}`);
    out.price = 'created';
  } else out.price = 'exists';
  out.price_id = price.id;

  const coupon = await stripe<{ id: string }>(env, 'GET', `coupons/${PREMIUM.introCouponId}`).catch(() => null);
  if (!coupon) {
    await stripe(env, 'POST', 'coupons', { id: PREMIUM.introCouponId, name: 'First month $5', amount_off: String(PREMIUM.priceCents - PREMIUM.introCents), currency: 'usd', duration: 'once' });
    out.intro_coupon = 'created';
  } else out.intro_coupon = 'exists';

  const configs = await stripe<{ data: { id: string; metadata?: { rentready?: string } }[] }>(env, 'GET', 'billing_portal/configurations', { active: 'true', limit: '20' });
  const existing = configs.data.find((c) => c.metadata?.rentready === 'premium');
  if (!existing) {
    const c = await stripe<{ id: string }>(env, 'POST', 'billing_portal/configurations', {
      'business_profile[headline]': 'Manage your RentReady Premium membership',
      'business_profile[terms_of_service_url]': `${origin}/premium#terms`,
      'features[payment_method_update][enabled]': 'true',
      'features[invoice_history][enabled]': 'true',
      'features[subscription_cancel][enabled]': 'true',
      'features[subscription_cancel][mode]': 'at_period_end',
      'features[subscription_cancel][cancellation_reason][enabled]': 'true',
      'features[subscription_cancel][cancellation_reason][options][0]': 'unused',
      'features[subscription_cancel][cancellation_reason][options][1]': 'too_expensive',
      'features[subscription_cancel][cancellation_reason][options][2]': 'missing_features',
      'features[subscription_cancel][cancellation_reason][options][3]': 'other',
      'metadata[rentready]': 'premium',
    });
    out.portal = `created ${c.id}`;
  } else out.portal = 'exists';
  return json(out);
};
