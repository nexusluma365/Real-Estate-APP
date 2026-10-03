// POST /.netlify/functions/confirm-intent
// Body: { leadId, paymentIntentId, product }   product: 'prescreen'|'modern'|'luxury'|'apartment_prep'|'gameplan'|'creditkit'
//
// The frontend never gets to just SAY a payment succeeded — this function
// re-fetches the PaymentIntent from Stripe itself and only grants
// entitlement if Stripe confirms it. It's used right after the $10
// Payment Element confirms client-side, and again after a customer
// completes a 3D Secure challenge on a later step.
const { getStripe } = require('./_lib/stripe');
const { getEntitlements, patchEntitlements } = require('./_lib/store');
const { sendWelcomeEmail } = require('./_lib/welcome-email');
const { sendDownloadEmail } = require('./_lib/download-email');
const { manychatMetadata } = require('./_lib/manychat');
const { hasActiveListingAccess, subscriptionStatusPatch } = require('./_lib/listing-access');

const FIELD_BY_PRODUCT = { prescreen: 'paid10', modern: 'paid27', luxury: 'paid27', apartment_prep: 'paid47', gameplan: 'paid27', creditkit: 'paid97' };

function setupErrorMessage(err) {
  const message = err && err.message ? err.message : '';
  if (
    message.includes('STRIPE_SECRET_KEY') ||
    message.includes('Invalid API Key') ||
    message.includes('No API key provided')
  ) {
    return message;
  }
  return '';
}

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

  const { leadId, paymentIntentId, product } = body;
  const field = FIELD_BY_PRODUCT[product];
  if (!leadId || !paymentIntentId || !field) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing or invalid fields' }) };
  }

  try {
    const stripe = getStripe();
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['invoice.subscription'],
    });

    const metadata = pi.metadata || {};
    const invoice = pi.invoice && typeof pi.invoice === 'object' ? pi.invoice : null;
    const subscription = invoice && invoice.subscription && typeof invoice.subscription === 'object'
      ? invoice.subscription
      : null;
    const subscriptionMetadata = (subscription && subscription.metadata) || {};
    const effectiveLeadId = metadata.leadId || subscriptionMetadata.leadId;
    if (effectiveLeadId !== leadId) {
      return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Lead mismatch' }) };
    }

    // Every PaymentIntent this site creates records which product it paid
    // for. Never let the browser claim a different (more expensive) product
    // for a payment — e.g. confirming the $9.99 pre-screen intent as the
    // $47 or $97 product.
    const paidProduct = String(metadata.product || subscriptionMetadata.product || '').toLowerCase();
    const expectedProduct = product === 'prescreen' ? ['prescreen', 'listing_membership'] : [String(product).toLowerCase()];
    if (paidProduct && !expectedProduct.includes(paidProduct)) {
      return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Product mismatch' }) };
    }

    if (pi.status === 'succeeded') {
      const currentEntitlements = await getEntitlements(leadId);
      const isListingSubscription = product === 'prescreen' && subscription;
      const isFirstPrescreenPayment = product === 'prescreen' && !currentEntitlements.paid10;

      const patch = { [field]: true };
      if (isListingSubscription) {
        Object.assign(patch, subscriptionStatusPatch(subscription));
      }
      if (product === 'apartment_prep') patch.paid27 = true;
      if (pi.customer) patch.stripeCustomerId = pi.customer;
      if (pi.payment_method) patch.defaultPaymentMethodId = pi.payment_method;
      Object.assign(patch, manychatMetadata((pi.metadata && pi.metadata.manychat_contact_id) || subscriptionMetadata.manychat_contact_id));
      if (product === 'modern' || product === 'luxury' || product === 'apartment_prep') patch.addPurchasedCategory = product;
      let entitlements = null;
      let entitlementWarning = null;

      try {
        entitlements = await patchEntitlements(leadId, patch);
      } catch (err) {
        entitlementWarning = 'Payment succeeded, but access status could not be saved immediately.';
        console.error('confirm-intent entitlement patch error', err);
      }

      // Make sure the customer's default payment method is set, so
      // subscriptions created later automatically use the right card.
      if (pi.customer && pi.payment_method) {
        try {
          await stripe.customers.update(pi.customer, {
            invoice_settings: { default_payment_method: pi.payment_method },
          });
        } catch (err) {
          console.error('confirm-intent customer update error', err);
        }
      }

      // "Thanks for joining" only goes out once, the first time the $10
      // pre-screen succeeds — never on a retry/refresh that re-confirms an
      // already-paid lead.
      if (isFirstPrescreenPayment && (!isListingSubscription || hasActiveListingAccess(entitlements || patch))) {
        try {
          await sendWelcomeEmail(leadId);
          await patchEntitlements(leadId, { listingSubscriptionWelcomeSentAt: new Date().toISOString() });
        } catch (err) {
          console.error('confirm-intent welcome email error', err);
        }
      }
      if (product === 'modern' || product === 'luxury' || product === 'apartment_prep') {
        try {
          await sendDownloadEmail(leadId, product);
        } catch (err) {
          console.error('confirm-intent download email error', err);
        }
      }

      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'succeeded', entitlements, warning: entitlementWarning }) };
    }

    if (pi.status === 'requires_action' || pi.status === 'requires_confirmation') {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, status: 'requires_action', clientSecret: pi.client_secret }),
      };
    }

    if (pi.status === 'processing') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'processing' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'failed' }) };
  } catch (err) {
    console.error('confirm-intent error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: setupErrorMessage(err) || 'Could not confirm payment.' }) };
  }
};
