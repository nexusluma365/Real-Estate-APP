// POST /.netlify/functions/stripe-webhook
// Configure this URL in the Stripe Dashboard → Developers → Webhooks, and
// put the signing secret it gives you into STRIPE_WEBHOOK_SECRET.
//
// The confirm-intent / charge-upsell / create-subscription functions
// already write entitlements the moment Stripe confirms a charge
// synchronously — this webhook exists as the backstop source of truth for
// everything else: 3DS completions that happen after the customer closed
// the tab, disputed/refunded charges, subscription renewals and
// cancellations. Every write here is idempotent (it just sets fields to
// their correct value), so it's safe if Stripe retries or a synchronous
// call already handled the same event.
//
// Every request must carry a valid Stripe signature over the RAW body, or it
// is rejected with 400 before anything is read. One-time upsells are granted
// through _lib/fulfillment.js (lead/product/price/currency checked, granted
// and logged exactly once even when Stripe redelivers the event).
const { getStripe } = require('./_lib/stripe');
const { getEntitlements, patchEntitlements } = require('./_lib/store');
const { sendWelcomeEmail } = require('./_lib/welcome-email');
const { manychatMetadata } = require('./_lib/manychat');
const { hasActiveListingAccess, subscriptionStatusPatch } = require('./_lib/listing-access');
const { logFunnelEvent } = require('./_lib/funnel');
const { productDef } = require('./_lib/products');
const { fulfillUpsellPaymentIntent, idOf } = require('./_lib/fulfillment');
const { paymentErrorLogFields } = require('./_lib/payment-errors');

const MEMBERSHIP_PLANS = new Set(['monthly', 'yearly']);
const ACTIVE_STATUSES = new Set(['active', 'trialing']);

// The listing trial subscription (created by confirm-intent) vs the separate
// RentReady Support membership (create-subscription.js). Only the listing
// subscription may drive listing access.
function isListingSubscription(subscription) {
  const metadata = (subscription && subscription.metadata) || {};
  const product = String(metadata.product || '').toLowerCase();
  if (product) return product === 'listing_membership';
  return !MEMBERSHIP_PLANS.has(String(metadata.plan || '').toLowerCase());
}

async function syncMembershipSubscription(subscription, deleted = false) {
  const metadata = (subscription && subscription.metadata) || {};
  if (!metadata.leadId) return;
  const active = !deleted && ACTIVE_STATUSES.has(String(subscription.status || '').toLowerCase());
  await patchEntitlements(metadata.leadId, {
    membershipStatus: active ? 'active' : 'inactive',
    membershipPlan: active ? metadata.plan || null : null,
    stripeSubscriptionId: subscription.id,
    ...manychatMetadata(metadata.manychat_contact_id),
  });
}

async function syncListingSubscription(stripe, subscription, options = {}) {
  if (!subscription || !subscription.id) return;
  if (!isListingSubscription(subscription)) {
    await syncMembershipSubscription(subscription);
    return;
  }
  const metadata = subscription.metadata || {};
  const leadId = metadata.leadId;
  if (!leadId) return;
  const currentEntitlements = (await getEntitlements(leadId)) || {};
  const patch = {
    paid10: hasActiveListingAccess(subscriptionStatusPatch(subscription)) ? true : !!currentEntitlements.paid10,
    stripeCustomerId: subscription.customer || currentEntitlements.stripeCustomerId || null,
    ...subscriptionStatusPatch(subscription),
    ...manychatMetadata(metadata.manychat_contact_id),
  };
  const defaultPaymentMethod =
    subscription.default_payment_method ||
    (subscription.latest_invoice &&
      typeof subscription.latest_invoice === 'object' &&
      subscription.latest_invoice.payment_intent &&
      typeof subscription.latest_invoice.payment_intent === 'object' &&
      subscription.latest_invoice.payment_intent.payment_method);
  if (defaultPaymentMethod) patch.defaultPaymentMethodId = typeof defaultPaymentMethod === 'string' ? defaultPaymentMethod : defaultPaymentMethod.id;

  const nextEntitlements = await patchEntitlements(leadId, patch);
  if (hasActiveListingAccess(nextEntitlements) && !currentEntitlements.listingSubscriptionWelcomeSentAt) {
    try {
      await sendWelcomeEmail(leadId);
      await patchEntitlements(leadId, { listingSubscriptionWelcomeSentAt: new Date().toISOString() });
    } catch (err) {
      console.error('stripe-webhook listing welcome email error', err);
      if (options.throwOnEmailFailure) throw err;
    }
  }

  if (subscription.customer && defaultPaymentMethod) {
    await stripe.customers.update(subscription.customer, {
      invoice_settings: { default_payment_method: typeof defaultPaymentMethod === 'string' ? defaultPaymentMethod : defaultPaymentMethod.id },
    }).catch((err) => console.error('stripe-webhook customer default payment update error', err));
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const headers = event.headers || {};
  const sig = headers['stripe-signature'] || headers['Stripe-Signature'];
  if (!sig || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Webhook rejected: missing signature or STRIPE_WEBHOOK_SECRET');
    return { statusCode: 400, body: 'Webhook Error: missing signature' };
  }
  let stripe;
  let stripeEvent;

  try {
    stripe = getStripe();
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : event.body;
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed', err.message);
    return { statusCode: 400, body: 'Webhook Error: signature verification failed' };
  }

  try {
    switch (stripeEvent.type) {
      case 'payment_intent.succeeded': {
        const pi = stripeEvent.data.object;
        const leadId = pi.metadata && pi.metadata.leadId;
        const product = pi.metadata && pi.metadata.product;
        if (leadId && productDef(product)) {
          const result = await fulfillUpsellPaymentIntent(stripe, pi);
          if (result.reason === 'mismatch') console.error('stripe-webhook ignored mismatched upsell PaymentIntent', pi.id);
        } else if (leadId && product === 'prescreen') {
          // Legacy $10 pre-screen payments made before the trial checkout.
          // Grants paid10 only; never replaces a card already on the lead.
          const currentEntitlements = (await getEntitlements(leadId)) || {};
          const isFirstPrescreenPayment = !currentEntitlements.paid10;
          const setsCard = !currentEntitlements.defaultPaymentMethodId &&
            (!currentEntitlements.stripeCustomerId || currentEntitlements.stripeCustomerId === idOf(pi.customer));
          const patch = { paid10: true, ...manychatMetadata(pi.metadata && pi.metadata.manychat_contact_id) };
          if (setsCard && pi.customer) patch.stripeCustomerId = idOf(pi.customer);
          if (setsCard && pi.payment_method) patch.defaultPaymentMethodId = idOf(pi.payment_method);
          await patchEntitlements(leadId, patch);
          if (setsCard && pi.customer && pi.payment_method) {
            await stripe.customers.update(idOf(pi.customer), {
              invoice_settings: { default_payment_method: idOf(pi.payment_method) },
            });
          }
          if (isFirstPrescreenPayment) {
            try {
              await sendWelcomeEmail(leadId);
            } catch (err) {
              console.error('stripe-webhook welcome email error', err);
            }
          }
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        // Never grants anything — diagnostics only (Stripe codes and card
        // funding type; no card details).
        const pi = stripeEvent.data.object;
        console.warn('stripe-webhook payment failed', {
          paymentIntentId: pi.id,
          product: (pi.metadata || {}).product || null,
          ...paymentErrorLogFields(pi.last_payment_error || {}),
        });
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        const sub = stripeEvent.data.object;
        await syncListingSubscription(stripe, sub);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        const leadId = sub.metadata && sub.metadata.leadId;
        if (leadId && !isListingSubscription(sub)) {
          await syncMembershipSubscription(sub, true);
        } else if (leadId) {
          await patchEntitlements(leadId, {
            ...subscriptionStatusPatch(sub),
            listingSubscriptionStatus: sub.status || 'canceled',
            listingAccessStatus: 'inactive',
          });
          await logFunnelEvent('subscription_canceled', { lead_id: leadId, payment_id: sub.id });
        }
        break;
      }

      case 'invoice.payment_succeeded':
      case 'invoice.paid': {
        const invoice = stripeEvent.data.object;
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription && invoice.subscription.id;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice.payment_intent'] });
          await syncListingSubscription(stripe, sub, { throwOnEmailFailure: true });
          // The $0 trial invoice also fires invoice.paid; only real charges count as "paid".
          if (invoice.amount_paid > 0) {
            await logFunnelEvent('subscription_paid', { lead_id: sub.metadata && sub.metadata.leadId, payment_id: invoice.id, amount: invoice.amount_paid / 100 });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription && invoice.subscription.id;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await syncListingSubscription(stripe, sub);
          await logFunnelEvent('subscription_payment_failed', { lead_id: sub.metadata && sub.metadata.leadId, payment_id: invoice.id, amount: (invoice.amount_due || 0) / 100 });
        }
        break;
      }

      default:
        break; // ignore everything else
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('stripe-webhook processing error', err && err.message);
    // Non-2xx tells Stripe to retry delivery, so a temporary storage outage
    // can't silently lose a paid entitlement. Entitlement patches are
    // idempotent and welcome/download emails are guarded by "first purchase"
    // checks, so retries cannot double-grant or double-email.
    return { statusCode: 500, body: JSON.stringify({ received: false, error: 'processing_failed' }) };
  }
};
