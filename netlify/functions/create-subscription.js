// POST /.netlify/functions/create-subscription
// Body: { plan, leadId? }   plan: 'monthly'|'yearly'
//
// Requires the signed 'paid' session cookie; the lead comes from the cookie
// (a leadId in the body must match it). The idempotency key is derived on the
// server per lead + plan + attempt window (see _lib/payment-attempts.js), and
// the saved card is tried at most twice before the customer is asked to use a
// different card.
//
// Real Stripe Subscriptions — not repeated manual one-time charges — so
// recurring billing, retries, and cancellation are handled by Stripe.
// Requires STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL (Stripe recurring
// Price IDs, created in the Dashboard) as environment variables.
const { getStripe } = require('./_lib/stripe');
const { getEntitlements, getLead, patchEntitlements } = require('./_lib/store');
const { normalizeManyChatContactId, manychatMetadata } = require('./_lib/manychat');
const { requireSession } = require('./_lib/session');
const attempts = require('./_lib/payment-attempts');

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

  const { plan } = body;
  const priceId = plan === 'yearly' ? process.env.STRIPE_PRICE_ANNUAL : plan === 'monthly' ? process.env.STRIPE_PRICE_MONTHLY : null;

  if (!priceId) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing or invalid fields' }) };
  }

  const auth = requireSession(event, { scope: 'paid', bodyLeadId: body.leadId });
  if (auth.error) return auth.error;
  const leadId = auth.leadId;
  const attemptProduct = `membership_${plan}`;

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

    let attemptState = attempts.attemptState(entitlements, attemptProduct, entitlements.defaultPaymentMethodId);
    if (attempts.blockedReason(attemptState)) {
      return { statusCode: 200, body: JSON.stringify(attempts.failureResponse(attemptState)) };
    }

    const stripe = getStripe();
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
      { idempotencyKey: attempts.idempotencyKey(leadId, attemptProduct, attemptState) }
    );

    const pi = subscription.latest_invoice && subscription.latest_invoice.payment_intent;

    if (pi && pi.status === 'succeeded') {
      await patchEntitlements(leadId, {
        ...attempts.clearedAttemptsPatch(entitlements, attemptProduct),
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
    const lastError = (pi && pi.last_payment_error) || {};
    attemptState = attempts.afterFailure(attemptState, lastError.decline_code || lastError.code || 'declined');
    await patchEntitlements(leadId, attempts.attemptsPatch(entitlements, attemptProduct, attemptState))
      .catch((err) => console.error('create-subscription attempt save error', err));
    return { statusCode: 200, body: JSON.stringify(attempts.failureResponse(attemptState)) };
  } catch (err) {
    console.error('create-subscription error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Could not process this membership.' }) };
  }
};
