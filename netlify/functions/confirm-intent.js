// POST /.netlify/functions/confirm-intent
// Body: { leadId, paymentIntentId, setupIntentId, product }
// product: 'prescreen'|'modern'|'luxury'|'apartment_prep'|'gameplan'|'creditkit'
//
// The frontend never gets to just SAY a payment succeeded — this function
// re-fetches the Stripe intent itself and only grants entitlement if Stripe
// confirms it. The listing checkout confirms a SetupIntent, then this
// function creates the 7-day trial subscription with the saved card.
const { getStripe } = require('./_lib/stripe');
const { getEntitlements, patchEntitlements } = require('./_lib/store');
const { sendWelcomeEmail } = require('./_lib/welcome-email');
const { sendDownloadEmail } = require('./_lib/download-email');
const { manychatMetadata } = require('./_lib/manychat');
const { hasActiveListingAccess, subscriptionStatusPatch } = require('./_lib/listing-access');
const { logFunnelEvent } = require('./_lib/funnel');

const FIELD_BY_PRODUCT = { prescreen: 'paid10', modern: 'paid27', luxury: 'paid27', apartment_prep: 'paid47', gameplan: 'paid27', creditkit: 'paid97' };

function listingPriceId() {
  return (
    process.env.STRIPE_LISTING_PRICE_MONTHLY ||
    process.env.STRIPE_PRICE_LISTING_MONTHLY ||
    process.env.STRIPE_RENTREADY_LISTING_PRICE_MONTHLY ||
    ''
  ).trim();
}

function listingPriceConfigError(priceId) {
  if (!priceId) return 'STRIPE_LISTING_PRICE_MONTHLY is not configured.';
  if (!priceId.startsWith('price_')) {
    return 'STRIPE_LISTING_PRICE_MONTHLY must be a Stripe recurring Price ID that starts with price_, not a Product ID.';
  }
  return '';
}

async function validateListingPrice(stripe, priceId) {
  const configError = listingPriceConfigError(priceId);
  if (configError) return configError;

  let price;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch (err) {
    const message = err && err.message ? err.message : 'Stripe could not retrieve the configured Price.';
    return `STRIPE_LISTING_PRICE_MONTHLY is not a usable Price ID in this Stripe account/mode: ${message}`;
  }

  if (!price || price.deleted) {
    return 'STRIPE_LISTING_PRICE_MONTHLY points to a deleted Stripe Price.';
  }
  if (price.active === false) {
    return 'STRIPE_LISTING_PRICE_MONTHLY points to an inactive Stripe Price.';
  }
  if (price.livemode !== true) {
    return 'STRIPE_LISTING_PRICE_MONTHLY must point to a live-mode Stripe Price.';
  }
  if (!price.recurring) {
    return 'STRIPE_LISTING_PRICE_MONTHLY must point to a recurring monthly Price, not a one-time Price.';
  }
  if (price.recurring.interval !== 'month') {
    return `STRIPE_LISTING_PRICE_MONTHLY must be monthly, but the configured Price is ${price.recurring.interval}.`;
  }
  if (price.currency !== 'usd') {
    return `STRIPE_LISTING_PRICE_MONTHLY must be a USD Price, but the configured Price is ${String(price.currency || '').toUpperCase() || 'unknown currency'}.`;
  }
  if (price.unit_amount !== 1999) {
    return `STRIPE_LISTING_PRICE_MONTHLY must be $19.99/month, but the configured Price is ${price.unit_amount == null ? 'missing an amount' : `${price.unit_amount} cents`}.`;
  }
  return '';
}

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

function subscriptionConversion(subscription) {
  const firstItem = subscription && subscription.items && Array.isArray(subscription.items.data)
    ? subscription.items.data[0]
    : null;
  const price = firstItem && firstItem.price ? firstItem.price : null;
  const amount = price && typeof price.unit_amount === 'number' ? price.unit_amount : null;
  return {
    value: amount === null ? 0 : amount / 100,
    currency: String((price && price.currency) || (subscription && subscription.currency) || 'usd').toUpperCase(),
  };
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

  const { leadId, paymentIntentId, setupIntentId, product } = body;
  const field = FIELD_BY_PRODUCT[product];
  if (!leadId || !(paymentIntentId || setupIntentId) || !field) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing or invalid fields' }) };
  }

  try {
    const stripe = getStripe();
    if (setupIntentId) {
      if (product !== 'prescreen') {
        return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Product mismatch' }) };
      }
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      const metadata = setupIntent.metadata || {};
      if (metadata.leadId !== leadId) {
        return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Lead mismatch' }) };
      }
      const paidProduct = String(metadata.product || '').toLowerCase();
      if (paidProduct && paidProduct !== 'listing_membership') {
        return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Product mismatch' }) };
      }
      if (setupIntent.status !== 'succeeded') {
        return { statusCode: 200, body: JSON.stringify({ ok: true, status: setupIntent.status || 'failed' }) };
      }
      const priceId = listingPriceId();
      const priceConfigError = await validateListingPrice(stripe, priceId);
      if (priceConfigError) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: priceConfigError }) };
      }
      const subscription = await stripe.subscriptions.create(
        {
          customer: setupIntent.customer,
          items: [{ price: priceId }],
          trial_period_days: 7,
          default_payment_method: setupIntent.payment_method,
          payment_settings: {
            save_default_payment_method: 'on_subscription',
            payment_method_types: ['card'],
          },
          metadata: { ...metadata, product: 'listing_membership', plan: 'trial_then_monthly' },
        },
        { idempotencyKey: `${leadId}:listing-subscription:trial-1999-v4` }
      );
      const statusPatch = subscriptionStatusPatch(subscription);
      if (!hasActiveListingAccess(statusPatch)) {
        await logFunnelEvent('trial_start_failed', {
          lead_id: leadId,
          payment_id: subscription && subscription.id,
          detail: { subscription_status: (subscription && subscription.status) || '' },
        });
        return {
          statusCode: 200,
          body: JSON.stringify({
            ok: true,
            status: (subscription && subscription.status) || 'failed',
            subscriptionId: subscription && subscription.id,
            subscriptionStatus: statusPatch.listingSubscriptionStatus,
          }),
        };
      }

      const currentEntitlements = await getEntitlements(leadId);
      const patch = {
        [field]: true,
        stripeCustomerId: setupIntent.customer || currentEntitlements.stripeCustomerId || null,
        defaultPaymentMethodId: setupIntent.payment_method || currentEntitlements.defaultPaymentMethodId || null,
        ...statusPatch,
      };
      Object.assign(patch, manychatMetadata(metadata.manychat_contact_id));

      let entitlements = null;
      let entitlementWarning = null;
      try {
        entitlements = await patchEntitlements(leadId, patch);
      } catch (err) {
        entitlementWarning = 'Trial started, but access status could not be saved immediately.';
        console.error('confirm-intent entitlement patch error', err);
      }
      if (setupIntent.customer && setupIntent.payment_method) {
        try {
          await stripe.customers.update(setupIntent.customer, {
            invoice_settings: { default_payment_method: setupIntent.payment_method },
          });
        } catch (err) {
          console.error('confirm-intent customer update error', err);
        }
      }
      if (!currentEntitlements.paid10 && hasActiveListingAccess(entitlements || patch)) {
        try {
          await sendWelcomeEmail(leadId);
          await patchEntitlements(leadId, { listingSubscriptionWelcomeSentAt: new Date().toISOString() });
        } catch (err) {
          console.error('confirm-intent welcome email error', err);
        }
      }
      await logFunnelEvent('trial_started', { lead_id: leadId, payment_id: subscription.id, detail: { subscription_status: subscription.status || '' } });
      const conversion = subscriptionConversion(subscription);
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          status: 'succeeded',
          subscriptionId: subscription.id,
          subscriptionStatus: statusPatch.listingSubscriptionStatus,
          subscriptionAmount: conversion.value,
          currency: conversion.currency,
          conversion: {
            product: 'listing_membership',
            type: 'new_subscriber',
            value: conversion.value,
            currency: conversion.currency,
          },
          entitlements,
          warning: entitlementWarning,
        }),
      };
    }

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
    // for a payment — e.g. confirming the trial verification intent as the
    // $47 or $97 product.
    const paidProduct = String(metadata.product || subscriptionMetadata.product || '').toLowerCase();
    const expectedProduct = product === 'prescreen'
      ? ['prescreen', 'listing_membership', 'listing_membership_verification']
      : [String(product).toLowerCase()];
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

      if (product !== 'prescreen') {
        await logFunnelEvent('upsell_paid', { lead_id: leadId, payment_id: pi.id, amount: (pi.amount_received || pi.amount || 0) / 100, detail: { product } });
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
