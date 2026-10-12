// POST /.netlify/functions/create-subscription
// Body: { leadId, plan }   plan: 'monthly'|'yearly'
//
// Uses the saved card, so it requires the verified-payer session cookie
// (see _lib/payer.js) — a bare leadId can't start a subscription. The
// idempotency key is derived on the server, so double clicks / two tabs
// create one subscription, not two.
//
// Real Stripe Subscriptions — not repeated manual one-time charges — so
// recurring billing, retries, and cancellation are handled by Stripe.
// Requires STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL (Stripe recurring
// Price IDs, created in the Dashboard) as environment variables.
const { getStripe } = require('./_lib/stripe');
const { getEntitlements, getLead, patchEntitlements } = require('./_lib/store');
const { normalizeManyChatContactId, manychatMetadata } = require('./_lib/manychat');
const { sessionForLead } = require('./_lib/session');
const { isVerifiedPayer } = require('./_lib/payer');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON body' }) };
  }

  const { leadId, plan } = body;
  const priceId = plan === 'yearly' ? process.env.STRIPE_PRICE_ANNUAL : plan === 'monthly' ? process.env.STRIPE_PRICE_MONTHLY : null;

  if (!leadId || !priceId) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing or invalid fields' }) };
  }

  try {
    const entitlements = await getEntitlements(leadId);
    if (!entitlements.paid10 || !entitlements.stripeCustomerId || !entitlements.defaultPaymentMethodId) {
      return {
        statusCode: 403,
        body: JSON.stringify({ ok: false, error: 'Complete the $10 pre-screen before joining Support.' }),
      };
    }

    if (entitlements.membershipStatus === 'active' && entitlements.membershipPlan === plan) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'succeeded', alreadyOwned: true }) };
    }

    const stripe = getStripe();
    if (!(await isVerifiedPayer(stripe, sessionForLead(event, leadId), entitlements, leadId))) {
      return {
        statusCode: 403,
        body: JSON.stringify({ ok: false, error: 'Please return to your results on the device you signed up with to join Support.' }),
      };
    }
    const lead = await getLead(leadId).catch(() => null);
    const manychatContactId = normalizeManyChatContactId(
      entitlements.manychat_contact_id ||
      entitlements.manychatContactId ||
      (lead && lead.manychat_contact_id)
    );
    const subscription = await stripe.subscriptions.create(
      {
        customer: entitlements.stripeCustomerId,
        items: [{ price: priceId }],
        default_payment_method: entitlements.defaultPaymentMethodId,
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: { leadId, plan, ...manychatMetadata(manychatContactId) },
      },
      { idempotencyKey: `rr-membership:v2:${leadId}:${plan}:${entitlements.defaultPaymentMethodId}` }
    );

    const pi = subscription.latest_invoice && subscription.latest_invoice.payment_intent;

    if (pi && pi.status === 'succeeded') {
      await patchEntitlements(leadId, {
        membershipStatus: 'active',
        membershipPlan: plan,
        stripeSubscriptionId: subscription.id,
        ...(manychatContactId ? { manychat_contact_id: manychatContactId, manychatContactId } : {}),
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'succeeded' }) };
    }

    if (pi && pi.status === 'requires_action') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          status: 'requires_action',
          clientSecret: pi.client_secret,
          subscriptionId: subscription.id,
        }),
      };
    }

    // Not going to succeed as-is — don't leave a dangling incomplete
    // subscription behind.
    try {
      await stripe.subscriptions.cancel(subscription.id);
    } catch (_e) {
      /* best effort */
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'failed', message: 'We couldn\u2019t complete this purchase with your saved payment method.' }) };
  } catch (err) {
    console.error('create-subscription error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Could not process this membership.' }) };
  }
};
