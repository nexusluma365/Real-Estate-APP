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
const { getStripe } = require('./_lib/stripe');
const { getEntitlements, patchEntitlements } = require('./_lib/store');
const { sendWelcomeEmail } = require('./_lib/welcome-email');
const { sendDownloadEmail } = require('./_lib/download-email');
const { manychatMetadata } = require('./_lib/manychat');
const { hasActiveListingAccess, subscriptionStatusPatch } = require('./_lib/listing-access');

const FIELD_BY_PRODUCT = { prescreen: 'paid10', modern: 'paid27', luxury: 'paid27', apartment_prep: 'paid47', gameplan: 'paid27', creditkit: 'paid97' };

async function syncListingSubscription(stripe, subscription, options = {}) {
  if (!subscription || !subscription.id) return;
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

  const stripe = getStripe();
  const headers = event.headers || {};
  const sig = headers['stripe-signature'] || headers['Stripe-Signature'];
  let stripeEvent;

  try {
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
    stripeEvent = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  try {
    switch (stripeEvent.type) {
      case 'payment_intent.succeeded': {
        const pi = stripeEvent.data.object;
        const leadId = pi.metadata && pi.metadata.leadId;
        const product = pi.metadata && pi.metadata.product;
        const field = FIELD_BY_PRODUCT[product];
        if (leadId && field) {
          const currentEntitlements = (await getEntitlements(leadId)) || {};
          const isFirstPrescreenPayment = product === 'prescreen' && !currentEntitlements.paid10;
          const isFirstDownloadPurchase =
            (product === 'modern' || product === 'luxury' || product === 'apartment_prep') &&
            !(currentEntitlements.purchasedCategories || []).includes(product);
          const patch = { [field]: true };
          if (product === 'apartment_prep') patch.paid27 = true;
          if (pi.customer) patch.stripeCustomerId = pi.customer;
          if (pi.payment_method) patch.defaultPaymentMethodId = pi.payment_method;
          Object.assign(patch, manychatMetadata(pi.metadata && pi.metadata.manychat_contact_id));
          if (product === 'modern' || product === 'luxury' || product === 'apartment_prep') patch.addPurchasedCategory = product;
          await patchEntitlements(leadId, patch);
          if (pi.customer && pi.payment_method) {
            await stripe.customers.update(pi.customer, {
              invoice_settings: { default_payment_method: pi.payment_method },
            });
          }
          // Backstop for the welcome email confirm-intent.js normally sends
          // synchronously — only fires if this webhook is the first thing to
          // ever see paid10 go true for this lead (e.g. the customer closed
          // the tab right after paying).
          if (isFirstPrescreenPayment) {
            try {
              await sendWelcomeEmail(leadId);
            } catch (err) {
              console.error('stripe-webhook welcome email error', err);
            }
          }
          if (isFirstDownloadPurchase) {
            try {
              await sendDownloadEmail(leadId, product);
            } catch (err) {
              console.error('stripe-webhook download email error', err);
            }
          }
        }
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
        if (leadId) {
          await patchEntitlements(leadId, {
            ...subscriptionStatusPatch(sub),
            listingSubscriptionStatus: sub.status || 'canceled',
            listingAccessStatus: 'inactive',
          });
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
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription && invoice.subscription.id;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await syncListingSubscription(stripe, sub);
        }
        break;
      }

      default:
        break; // ignore everything else
    }

    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  } catch (err) {
    console.error('stripe-webhook processing error', err);
    // Non-2xx tells Stripe to retry delivery, so a temporary storage outage
    // can't silently lose a paid entitlement. Entitlement patches are
    // idempotent and welcome/download emails are guarded by "first purchase"
    // checks, so retries cannot double-grant or double-email.
    return { statusCode: 500, body: JSON.stringify({ received: false, error: 'processing_failed' }) };
  }
};
