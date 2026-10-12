// POST /.netlify/functions/charge-upsell
// Body: { leadId, product }   product: 'modern'|'luxury'|'apartment_prep'|'gameplan'|'creditkit'
//
// Customer-initiated (on-session) purchase: it only runs when the customer
// presses the disclosed-price button, so no product is charged off_session.
// Prices come from _lib/products.js ($20 upsells, $97 Credit Kit), never
// from the browser.
//
// Every attempt for a lead+product reuses ONE PaymentIntent (Stripe
// idempotency key derived on the server, not a random key from the
// browser). A PaymentIntent can only succeed once, so double clicks, two
// tabs, refreshes, network retries and the alternate-card form can't
// produce two charges for the same purchase.
//
// One-click charging of the card saved at trial signup requires the
// browser's rr_session cookie to belong to the SetupIntent that saved that
// card (see _lib/payer.js). Without it the customer can still buy, but only
// by entering a card in Stripe Elements — a bare leadId can never charge
// anyone's saved card.
//
// Response shapes (always { ok: true, status, ... } unless ok:false):
//   succeeded                — paid and granted (alreadyOwned when a no-op)
//   processing               — Stripe still processing; poll entitlements
//   requires_action          — { clientSecret, paymentIntentId, amount }: run 3-D Secure
//   requires_payment_method  — { clientSecret, paymentIntentId, amount,
//                                decline: {code,message}|null, savedCard }:
//                                collect a card with Stripe Elements
//   failed                   — cannot be completed
const { getStripe } = require('./_lib/stripe');
const { getEntitlements, getLead } = require('./_lib/store');
const { determineFocus } = require('./_lib/focus');
const { sendDownloadEmail } = require('./_lib/download-email');
const { normalizeManyChatContactId, manychatMetadata } = require('./_lib/manychat');
const { logFunnelEvent } = require('./_lib/funnel');
const { sessionForLead } = require('./_lib/session');
const { UPSELL_PRODUCTS, CURRENCY, productDef, ownsProduct } = require('./_lib/products');
const { isVerifiedPayer } = require('./_lib/payer');
const { fulfillUpsellPaymentIntent, idOf } = require('./_lib/fulfillment');
const { describePaymentError, paymentErrorLogFields } = require('./_lib/payment-errors');
const rateLimit = require('./_lib/rate-limit');

const KEY_VERSION = 'v2';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function receiptEmailFromLead(lead) {
  const email = String((lead && (lead.email || lead.Email || lead.contact_email)) || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function isIdempotencyError(err) {
  return !!err && (err.type === 'StripeIdempotencyError' || err.type === 'idempotency_error' || (err.raw && err.raw.type === 'idempotency_error'));
}

function isCardError(err) {
  return !!err && (err.type === 'StripeCardError' || (err.raw && err.raw.type === 'card_error'));
}

async function upsellIntent(stripe, { leadId, product, def, customer, manychatContactId, receiptEmail }) {
  const baseKey = customer
    ? `rr-upsell:${KEY_VERSION}:${leadId}:${product}:${customer}`
    : `rr-upsell-guest:${KEY_VERSION}:${leadId}:${product}`;
  // Every value here must stay identical across clicks: Stripe rejects a
  // reused idempotency key whose parameters changed. Values that can change
  // later (ManyChat id, receipt email) are attached afterwards.
  const params = {
    amount: def.amount,
    currency: CURRENCY,
    payment_method_types: ['card'],
    payment_method_options: { card: { request_three_d_secure: 'automatic' } },
    description: def.label,
    metadata: { leadId, product, category: def.category || '' },
    // Only a verified payer's PaymentIntent is attached to the Stripe
    // customer, so only they can pay it with the customer's saved card.
    ...(customer ? { customer } : {}),
  };
  let pi = await stripe.paymentIntents.create(params, { idempotencyKey: baseKey });
  // An idempotent replay returns the object as first created; re-read it.
  pi = await stripe.paymentIntents.retrieve(pi.id);
  if (pi.status === 'canceled') {
    pi = await stripe.paymentIntents.create(params, { idempotencyKey: `${baseKey}:after:${pi.id}` });
    pi = await stripe.paymentIntents.retrieve(pi.id);
  }
  if (pi.status !== 'succeeded') {
    const update = {};
    const manychat = manychatMetadata(manychatContactId);
    if (manychat.manychat_contact_id && (pi.metadata || {}).manychat_contact_id !== manychat.manychat_contact_id) update.metadata = manychat;
    if (customer && receiptEmail && pi.receipt_email !== receiptEmail) update.receipt_email = receiptEmail;
    if (Object.keys(update).length) {
      try {
        pi = await stripe.paymentIntents.update(pi.id, update);
      } catch (err) {
        console.warn('charge-upsell PaymentIntent detail update failed', err && err.code);
      }
    }
  }
  return pi;
}

function needsCard(pi, def, decline, savedCard) {
  return json(200, {
    ok: true,
    status: 'requires_payment_method',
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id,
    amount: def.amount,
    decline: decline || null,
    savedCard: !!savedCard,
  });
}

async function respondForIntent(stripe, pi, ctx) {
  const { def, savedPaymentMethod, leadId, product } = ctx;

  if (pi.status === 'succeeded') {
    let warning = null;
    let alreadyOwned = false;
    try {
      const result = await fulfillUpsellPaymentIntent(stripe, pi);
      alreadyOwned = !!result.duplicate;
    } catch (err) {
      warning = 'Purchase succeeded, but access status could not be saved immediately.';
      console.error('charge-upsell fulfillment error', err);
    }
    return json(200, { ok: true, status: 'succeeded', paymentIntentId: pi.id, ...(alreadyOwned ? { alreadyOwned } : {}), warning });
  }

  if (pi.status === 'processing') return json(200, { ok: true, status: 'processing', paymentIntentId: pi.id });

  if (pi.status === 'requires_action') {
    return json(200, { ok: true, status: 'requires_action', clientSecret: pi.client_secret, paymentIntentId: pi.id, amount: def.amount });
  }

  if (pi.status === 'requires_payment_method' || pi.status === 'requires_confirmation') {
    const lastError = pi.last_payment_error;
    const savedCardAlreadyFailed = !!lastError && idOf(lastError.payment_method) === savedPaymentMethod;
    if (savedPaymentMethod && !savedCardAlreadyFailed && ctx.allowConfirm) {
      let confirmed;
      try {
        // On-session confirmation: no off_session flag. If the bank wants
        // 3-D Secure, Stripe returns requires_action for the browser.
        confirmed = await stripe.paymentIntents.confirm(
          pi.id,
          { payment_method: savedPaymentMethod },
          { idempotencyKey: `rr-upsell-confirm:${KEY_VERSION}:${pi.id}:${savedPaymentMethod}` }
        );
      } catch (err) {
        if (isCardError(err)) {
          const decline = describePaymentError(err);
          console.warn('charge-upsell saved card declined', { leadId, product, amount: def.amount, paymentIntentId: pi.id, ...paymentErrorLogFields(err) });
          await logFunnelEvent('upsell_failed', { lead_id: leadId, detail: { product, reason: decline.code, amount: def.amount } });
          const declinedPi = err.raw && err.raw.payment_intent && err.raw.payment_intent.client_secret ? err.raw.payment_intent : pi;
          return needsCard(declinedPi, def, decline, true);
        }
        throw err;
      }
      return respondForIntent(stripe, confirmed, { ...ctx, allowConfirm: false });
    }
    if (lastError) {
      console.warn('charge-upsell previous attempt declined', { leadId, product, paymentIntentId: pi.id, ...paymentErrorLogFields(lastError) });
    }
    return needsCard(pi, def, lastError ? describePaymentError(lastError) : null, !!savedPaymentMethod);
  }

  return json(200, {
    ok: true,
    status: 'failed',
    message: product === 'apartment_prep'
      ? 'We couldn’t complete the $20 purchase with this card.'
      : 'We couldn’t complete this purchase with your saved payment method.',
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_e) {
    return json(400, { ok: false, error: 'Invalid JSON body' });
  }

  const leadId = String(body.leadId || '').trim();
  const product = body.product;
  const def = UPSELL_PRODUCTS.includes(product) ? productDef(product) : null;
  if (!leadId || !def) {
    return json(400, { ok: false, error: 'Missing or invalid fields' });
  }

  // A brake on automated hammering only. Declines are not counted against
  // anyone, and entering another card happens in Stripe.js, not here.
  if (!rateLimit.allow([
    { key: `upsell:ip:${rateLimit.clientIp(event)}`, limit: 30, windowMs: 60 * 1000 },
    { key: `upsell:lead:${leadId}`, limit: 15, windowMs: 60 * 1000 },
  ])) {
    return json(429, { ok: false, status: 'rate_limited', error: 'Too many attempts. Please wait a minute and try again.' });
  }

  try {
    const stripe = getStripe();
    const entitlements = await getEntitlements(leadId);
    if (!entitlements.paid10) {
      return json(403, { ok: false, error: 'Complete the listing access checkout before this step.' });
    }

    // Already-purchased is a no-op success, never a second charge.
    if (ownsProduct(entitlements, product)) {
      if (def.category) {
        try {
          await sendDownloadEmail(leadId, def.category);
        } catch (err) {
          console.error('charge-upsell download email error', err);
        }
      }
      return json(200, { ok: true, status: 'succeeded', alreadyOwned: true });
    }

    const lead = await getLead(leadId).catch(() => null);

    // Server-side relevance guard for the conditional $97 offer.
    if (product === 'creditkit' && (!lead || determineFocus(lead) !== 'credit')) {
      return json(400, { ok: false, error: 'This offer is not relevant to your results.' });
    }

    const payer = await isVerifiedPayer(stripe, sessionForLead(event, leadId), entitlements, leadId);
    const manychatContactId = normalizeManyChatContactId(
      entitlements.manychat_contact_id || entitlements.manychatContactId || (lead && lead.manychat_contact_id)
    );
    const pi = await upsellIntent(stripe, {
      leadId,
      product,
      def,
      customer: payer ? entitlements.stripeCustomerId : null,
      manychatContactId,
      receiptEmail: receiptEmailFromLead(lead),
    });
    return await respondForIntent(stripe, pi, {
      def,
      leadId,
      product,
      savedPaymentMethod: payer ? entitlements.defaultPaymentMethodId : null,
      allowConfirm: true,
    });
  } catch (err) {
    if (isIdempotencyError(err)) {
      return json(409, { ok: false, status: 'in_progress', error: 'Your purchase is already being processed. Please wait a moment and try again.' });
    }
    // Stripe/API and internal errors are reported as such — never as a bank decline.
    console.error('charge-upsell error', { ...paymentErrorLogFields(err), message: err && err.message });
    const described = describePaymentError(err);
    return json(500, { ok: false, status: 'failed', code: described.code, error: described.message });
  }
};
