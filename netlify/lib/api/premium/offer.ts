import { getSession, json, type Ctx } from '../../_lib';
import { PREMIUM, premiumStatus } from '../../premium';

/**
 * GET /api/premium/offer — the membership terms this visitor would get at checkout, from the same config
 * /api/premium/checkout uses, so the offer shown before checkout always matches what Stripe will charge.
 * offer=trial ("$0 down", the apartment-match paywall) is for first memberships only; returning members pay the full price.
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  const s = await getSession(request, env);
  const status = await premiumStatus(env, s?.customer_id, s?.lead_id);
  const first = !status.had_premium;
  return json({
    active: status.active,
    price_cents: PREMIUM.priceCents,
    trial_days: first ? PREMIUM.trialDays : 0,
    due_today_cents: first ? 0 : PREMIUM.priceCents,
    grace_days: PREMIUM.graceDays,
  });
};
