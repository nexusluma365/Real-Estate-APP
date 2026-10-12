// POST /.netlify/functions/confirm-intent
// Body: { leadId, paymentIntentId, setupIntentId, product }
// product: 'prescreen'|'modern'|'luxury'|'apartment_prep'|'gameplan'|'creditkit'
//
// The frontend never gets to just SAY a payment succeeded — this function
// re-fetches the Stripe intent itself and only grants entitlement if Stripe
// confirms it. The listing checkout confirms a SetupIntent, then this
// function creates the 7-day trial subscription with the saved card.
//
// Upsell PaymentIntents are checked against lead, product, server price and
// currency (a $20 payment can never unlock the $97 kit) and granted through
// _lib/fulfillment.js. A lead's saved card / Stripe customer is never
// replaced here without the owning browser's session.
const { getStripe } = require('./_lib/stripe');
const { getEntitlements, patchEntitlements } = require('./_lib/store');
const { sendWelcomeEmail } = require('./_lib/welcome-email');
const { manychatMetadata } = require('./_lib/manychat');
const { hasActiveListingAccess, listingAccessStatus, subscriptionStatusPatch } = require('./_lib/listing-access');
const { logFunnelEvent } = require('./_lib/funnel');
const { sessionForLead } = require('./_lib/session');
const { productDef, paymentIntentMatches } = require('./_lib/products');
const { fulfillUpsellPaymentIntent, idOf } = require('./_lib/fulfillment');
const { describePaymentError } = require('./_lib/payment-errors');

const LISTING_PRODUCTS = ['prescreen', 'listing_membership', 'listing_membership_verification'];

function stripeSecretMode() {
  const key = String(process.env.STRIPE_SECRET_KEY || '');
  if (key.startsWith('sk_test_') || key.startsWith('rk_test_')) return 'test';
  return 'live';
}

// Never send Stripe customer / payment-method identifiers to the browser.
function publicEntitlements(e) {
  if (!e) return null;
  return {
    paid10: !!e.paid10,
    paid27: !!e.paid27,
    paid47: !!e.paid47,
    paid97: !!e.paid97,
    paidGameplan: !!e.paidGameplan,
    purchasedCategories: Array.isArray(e.purchasedCategories) ? e.purchasedCategories : [],
    listingAccessStatus: listingAccessStatus(e),
    listingSubscriptionStatus: e.listingSubscriptionStatus || 'inactive',
  };
}

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
  // The Price must be in the same Stripe mode as STRIPE_SECRET_KEY (live in
  // production, test on a test-mode deploy).
  const wantLive = stripeSecretMode() === 'live';
  if (price.livemode !== wantLive) {
    return `STRIPE_LISTING_PRICE_MONTHLY must point to a ${wantLive ? 'live' : 'test'}-mode Stripe Price.`;
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
  const validProduct = product === 'prescreen' || !!productDef(product);
  if (!leadId || !(paymentIntentId || setupIntentId) || !validProduct) {
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
      if (paidProduct !== 'listing_membership') {
        return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Product mismatch' }) };
      }
      if (setupIntent.status !== 'succeeded') {
        return { statusCode: 200, body: JSON.stringify({ ok: true, status: setupIntent.status || 'failed' }) };
      }

      const setupCustomer = idOf(setupIntent.customer);
      const setupPaymentMethod = idOf(setupIntent.payment_method);
      const existing = await getEntitlements(leadId);
      const session = sessionForLead(event, leadId);
      const fromOwningBrowser = !!(session && session.si === setupIntent.id);
      // A lead that already has a saved card or access keeps its Stripe
      // customer unless the owning browser is the one changing it.
      const leadEstablished = !!existing.defaultPaymentMethodId || hasActiveListingAccess(existing);
      if (existing.stripeCustomerId && setupCustomer !== existing.stripeCustomerId && leadEstablished && !fromOwningBrowser) {
        return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Customer mismatch' }) };
      }
      // A card already saved on this lead can only be replaced by the browser
      // that created this SetupIntent — never by a request that merely knows
      // the leadId and some SetupIntent id.
      if (existing.defaultPaymentMethodId && existing.defaultPaymentMethodId !== setupPaymentMethod && !fromOwningBrowser && !hasActiveListingAccess(existing)) {
        return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Please restart checkout from the device you signed up with.' }) };
      }

      // Already a member (a retry of this same checkout, a second tab, or a
      // stale form): never create another subscription or swap the card.
      if (hasActiveListingAccess(existing)) {
        const sameCard = existing.cardSetupIntentId === setupIntent.id ||
          (!existing.cardSetupIntentId && existing.defaultPaymentMethodId === setupPaymentMethod);
        if (sameCard && !existing.cardSetupIntentId) {
          await patchEntitlements(leadId, { cardSetupIntentId: setupIntent.id }).catch((err) => console.error('confirm-intent cardSetupIntentId backfill failed', err && err.message));
        }
        return {
          statusCode: 200,
          body: JSON.stringify({
            ok: true,
            status: 'succeeded',
            alreadyActive: true,
            subscriptionId: existing.listingSubscriptionId || null,
            subscriptionStatus: existing.listingSubscriptionStatus || 'active',
            entitlements: publicEntitlements(existing),
          }),
        };
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
          default_payment_method: setupPaymentMethod,
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

      const currentEntitlements = existing;
      // The subscription idempotency key is per lead, so a second checkout
      // for the same lead gets the FIRST subscription back. The card on that
      // subscription is the lead's saved card, and only the SetupIntent that
      // saved it makes a browser the one-click payer.
      const subscriptionPaymentMethod = idOf(subscription.default_payment_method) || setupPaymentMethod;
      const patch = {
        paid10: true,
        stripeCustomerId: setupCustomer || currentEntitlements.stripeCustomerId || null,
        defaultPaymentMethodId: subscriptionPaymentMethod || currentEntitlements.defaultPaymentMethodId || null,
        ...(subscriptionPaymentMethod === setupPaymentMethod ? { cardSetupIntentId: setupIntent.id } : {}),
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
      if (setupCustomer && subscriptionPaymentMethod) {
        try {
          await stripe.customers.update(setupCustomer, {
            invoice_settings: { default_payment_method: subscriptionPaymentMethod },
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
          entitlements: publicEntitlements(entitlements || { ...currentEntitlements, ...patch }),
          warning: entitlementWarning,
        }),
      };
    }

    // One-time upsells: verified against lead, product, price and currency,
    // then granted exactly once through the shared fulfillment rules.
    if (product !== 'prescreen') {
      const upsellPi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (!paymentIntentMatches(upsellPi, product, leadId)) {
        return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Product mismatch' }) };
      }
      if (upsellPi.status === 'succeeded') {
        let entitlements = null;
        let warning = null;
        try {
          const result = await fulfillUpsellPaymentIntent(stripe, upsellPi);
          entitlements = result.entitlements || null;
        } catch (err) {
          warning = 'Payment succeeded, but access status could not be saved immediately.';
          console.error('confirm-intent entitlement patch error', err);
        }
        return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'succeeded', entitlements: publicEntitlements(entitlements), warning }) };
      }
      if (upsellPi.status === 'requires_action' || upsellPi.status === 'requires_confirmation') {
        return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'requires_action', clientSecret: upsellPi.client_secret }) };
      }
      if (upsellPi.status === 'processing') {
        return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'processing' }) };
      }
      const decline = upsellPi.last_payment_error ? describePaymentError(upsellPi.last_payment_error) : null;
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'failed', decline }) };
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
    if (!LISTING_PRODUCTS.includes(paidProduct)) {
      return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Product mismatch' }) };
    }

    if (pi.status === 'succeeded') {
      const currentEntitlements = await getEntitlements(leadId);
      const isListingSubscription = !!subscription;
      const isFirstPrescreenPayment = !currentEntitlements.paid10;

      const patch = { paid10: true };
      if (isListingSubscription) {
        Object.assign(patch, subscriptionStatusPatch(subscription));
      }
      // Never replace a saved card or customer that is already on the lead.
      const setsCard = !currentEntitlements.defaultPaymentMethodId &&
        (!currentEntitlements.stripeCustomerId || currentEntitlements.stripeCustomerId === idOf(pi.customer));
      if (setsCard && pi.customer) patch.stripeCustomerId = idOf(pi.customer);
      if (setsCard && pi.payment_method) patch.defaultPaymentMethodId = idOf(pi.payment_method);
      Object.assign(patch, manychatMetadata((pi.metadata && pi.metadata.manychat_contact_id) || subscriptionMetadata.manychat_contact_id));
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
      if (setsCard && pi.customer && pi.payment_method) {
        try {
          await stripe.customers.update(idOf(pi.customer), {
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
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'succeeded', entitlements: publicEntitlements(entitlements), warning: entitlementWarning }) };
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
    console.error('confirm-intent error', err && err.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: setupErrorMessage(err) || 'Could not confirm payment.' }) };
  }
};
