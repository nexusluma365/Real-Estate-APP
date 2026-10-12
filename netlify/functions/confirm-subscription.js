// POST /.netlify/functions/confirm-subscription
// Body: { subscriptionId, plan, leadId? }   (lead comes from the 'paid' session cookie)
//
// Called after stripe.confirmCardPayment() resolves client-side for a
// subscription's first invoice that required 3D Secure. Re-checks with
// Stripe directly before granting membership access.
const { getStripe } = require('./_lib/stripe');
const { patchEntitlements } = require('./_lib/store');
const { manychatMetadata } = require('./_lib/manychat');
const { requireSession } = require('./_lib/session');

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

  const { subscriptionId, plan } = body;
  if (!subscriptionId || !plan) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing fields' }) };
  }
  const auth = requireSession(event, { scope: 'paid', bodyLeadId: body.leadId });
  if (auth.error) return auth.error;
  const leadId = auth.leadId;

  try {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice.payment_intent'],
    });

    if (subscription.metadata.leadId !== leadId) {
      return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Lead mismatch' }) };
    }

    const pi = subscription.latest_invoice && subscription.latest_invoice.payment_intent;

    if (subscription.status === 'active' || (pi && pi.status === 'succeeded')) {
      await patchEntitlements(leadId, {
        membershipStatus: 'active',
        membershipPlan: plan,
        stripeSubscriptionId: subscription.id,
        ...manychatMetadata(subscription.metadata && subscription.metadata.manychat_contact_id),
      });
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'succeeded' }) };
    }

    if (pi && pi.status === 'requires_action') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'requires_action', clientSecret: pi.client_secret }) };
    }

    try {
      await stripe.subscriptions.cancel(subscription.id);
    } catch (_e) {
      /* best effort */
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'failed' }) };
  } catch (err) {
    console.error('confirm-subscription error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Could not confirm membership.' }) };
  }
};
