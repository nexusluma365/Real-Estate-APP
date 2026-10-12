// POST /.netlify/functions/charge-upsell
// Body: { product, leadId? }   product: 'modern'|'luxury'|'apartment_prep'|'gameplan'|'creditkit'
//
// This is the actual "one click" purchase: no card form, no redirect —
// it charges the payment method saved during listing trial checkout. It only
// runs when the customer presses the disclosed-price button on the page;
// nothing here fires on page load, scroll, or navigation.
//
// Security / reliability rules:
//  * Requires the signed 'paid' session cookie (issued by confirm-intent once
//    the trial card is saved). The lead comes from that cookie; a leadId in
//    the body is only accepted if it matches. A bare leadId is never enough.
//  * Charged ON-SESSION (customer-initiated): the customer is on the page and
//    clicked the button. If the bank wants 3-D Secure, we return
//    requires_action and the page completes it with Stripe.js.
//  * The idempotency key is derived on the server per lead + product +
//    attempt window, so double clicks / two tabs can't double charge, and the
//    saved card is tried at most twice (once on insufficient_funds) before
//    the customer is asked to use a different card.
const { getStripe } = require('./_lib/stripe');
const { getEntitlements, getLead, patchEntitlements } = require('./_lib/store');
const { determineFocus } = require('./_lib/focus');
const { sendDownloadEmail } = require('./_lib/download-email');
const { normalizeManyChatContactId, manychatMetadata } = require('./_lib/manychat');
const { logFunnelEvent } = require('./_lib/funnel');
const { requireSession } = require('./_lib/session');
const attempts = require('./_lib/payment-attempts');

const PRODUCTS = {
  gameplan: { amount: 2000, field: 'paid27', label: 'RentReady Game Plan' },
  modern: { amount: 2000, field: 'paid27', label: 'RentReady Modern Apartment Matches & RentReady Guide', category: 'modern' },
  luxury: { amount: 2000, field: 'paid27', label: 'RentReady Luxury Apartment Matches & RentReady Guide', category: 'luxury' },
  apartment_prep: { amount: 2000, field: 'paid47', legacyField: 'paid27', label: 'RentReady Apartment Approval Preparation Kit', category: 'apartment_prep' },
  creditkit: { amount: 9700, field: 'paid97', label: 'RentReady Credit Action Kit' },
};

function receiptEmailFromLead(lead) {
  const email = String((lead && (lead.email || lead.Email || lead.contact_email)) || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function safeDeclineLog(err, product, def, leadId) {
  const raw = (err && err.raw) || {};
  const paymentIntent = raw.payment_intent || err.payment_intent || null;
  return {
    product,
    amount: def && def.amount,
    type: err && (err.type || raw.type),
    code: err && (err.code || raw.code),
    declineCode: err && (err.decline_code || raw.decline_code),
    paymentIntentId: paymentIntent && paymentIntent.id,
    leadId,
  };
}

function safeDeclineReason(err) {
  return (
    (err && (err.decline_code || (err.raw && err.raw.decline_code))) ||
    (err && (err.code || (err.raw && err.raw.code))) ||
    'declined'
  );
}

async function recoverPrescreenEntitlements(stripe, leadId, prescreenPaymentIntentId, current) {
  if (!prescreenPaymentIntentId) return current;
  let pi;
  try {
    pi = await stripe.paymentIntents.retrieve(prescreenPaymentIntentId);
  } catch (err) {
    console.warn('charge-upsell prescreen recovery lookup failed', err.code || err.message);
    return current;
  }
  const metadata = pi.metadata || {};
  if (metadata.leadId !== leadId || metadata.product !== 'prescreen' || pi.status !== 'succeeded') {
    return current;
  }
  if (!pi.customer || !pi.payment_method) return current;

  const patch = {
    paid10: true,
    stripeCustomerId: pi.customer,
    defaultPaymentMethodId: pi.payment_method,
    ...manychatMetadata(metadata.manychat_contact_id),
  };

  try {
    return await patchEntitlements(leadId, patch);
  } catch (err) {
    console.error('charge-upsell prescreen recovery save error', err);
    return { ...current, ...patch, leadId };
  }
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function alreadyOwned(entitlements, def) {
  const hasField = entitlements[def.field] || (def.legacyField && entitlements[def.legacyField]);
  return !!(hasField && (!def.category || (entitlements.purchasedCategories || []).includes(def.category)));
}

async function saveAttempts(leadId, entitlements, product, state) {
  try {
    await patchEntitlements(leadId, attempts.attemptsPatch(entitlements, product, state));
  } catch (err) {
    console.error('charge-upsell attempt save error', err);
  }
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

  const { product, prescreenPaymentIntentId } = body;
  const def = PRODUCTS[product];
  if (!def) {
    return json(400, { ok: false, error: 'Missing or invalid fields' });
  }

  const auth = requireSession(event, { scope: 'paid', bodyLeadId: body.leadId });
  if (auth.error) return auth.error;
  const leadId = auth.leadId;

  try {
    let entitlements = await getEntitlements(leadId);
    const stripe = getStripe();
    const lead = await getLead(leadId).catch(() => null);
    const manychatContactId = normalizeManyChatContactId(
      entitlements.manychat_contact_id ||
      entitlements.manychatContactId ||
      (lead && lead.manychat_contact_id)
    );

    if (!entitlements.paid10 || !entitlements.stripeCustomerId || !entitlements.defaultPaymentMethodId) {
      entitlements = await recoverPrescreenEntitlements(stripe, leadId, prescreenPaymentIntentId, entitlements);
    }

    if (!entitlements.paid10 || !entitlements.stripeCustomerId || !entitlements.defaultPaymentMethodId) {
      return json(403, { ok: false, error: 'Complete the listing access checkout before this step.' });
    }

    // Already-purchased is a no-op success, not a second charge. A customer
    // can own more than one apartment category, so this checks membership
    // in the full set, not equality against the single most-recent one.
    if (alreadyOwned(entitlements, def)) {
      if (def.category && def.sendDownloadEmail !== false) {
        try {
          await sendDownloadEmail(leadId, def.category);
        } catch (err) {
          console.error('charge-upsell download email error', err);
        }
      }
      return json(200, { ok: true, status: 'succeeded', alreadyOwned: true });
    }

    // Server-side relevance guard for the conditional $97 offer — a
    // customer can't unlock it just by hitting this endpoint if their own
    // answers don't indicate a credit/history issue worth reviewing.
    if (product === 'creditkit') {
      if (!lead || determineFocus(lead) !== 'credit') {
        return json(400, { ok: false, error: 'This offer is not relevant to your results.' });
      }
    }

    // Retry cap: don't keep hitting a card the bank has already refused.
    let attemptState = attempts.attemptState(entitlements, product, entitlements.defaultPaymentMethodId);
    if (attempts.blockedReason(attemptState)) {
      await logFunnelEvent('upsell_blocked', { lead_id: leadId, detail: { product, reason: attempts.blockedReason(attemptState) } });
      return json(200, attempts.failureResponse(attemptState));
    }

    let pi = null;

    // A previous click needed 3-D Secure. Look at where that payment ended
    // up instead of replaying the cached "requires_action" response forever.
    if (attemptState.pendingPaymentIntentId) {
      const pending = await stripe.paymentIntents.retrieve(attemptState.pendingPaymentIntentId).catch(() => null);
      if (pending && pending.status === 'requires_action') {
        return json(200, { ok: true, status: 'requires_action', clientSecret: pending.client_secret, paymentIntentId: pending.id });
      }
      if (pending && pending.status === 'processing') {
        return json(200, { ok: true, status: 'processing', paymentIntentId: pending.id });
      }
      if (pending && pending.status === 'succeeded') {
        // Paid after authentication — grant it below, never charge again.
        pi = pending;
      } else {
        const pendingError = (pending && pending.last_payment_error) || {};
        attemptState = attempts.afterFailure(
          { ...attemptState, pendingPaymentIntentId: null },
          pendingError.decline_code || (pendingError.code === 'payment_intent_authentication_failure' ? 'authentication_failed' : pendingError.code) || 'authentication_failed'
        );
        await saveAttempts(leadId, entitlements, product, attemptState);
        if (attempts.blockedReason(attemptState)) {
          return json(200, attempts.failureResponse(attemptState));
        }
      }
    }

    if (!pi) {
      try {
        pi = await stripe.paymentIntents.create(
          {
            amount: def.amount,
            currency: 'usd',
            customer: entitlements.stripeCustomerId,
            payment_method: entitlements.defaultPaymentMethodId,
            payment_method_types: ['card'],
            payment_method_options: { card: { request_three_d_secure: 'automatic' } },
            confirm: true,
            description: def.label,
            receipt_email: receiptEmailFromLead(lead),
            metadata: { leadId, product, category: def.category || '', ...manychatMetadata(manychatContactId) },
          },
          { idempotencyKey: attempts.idempotencyKey(leadId, product, attemptState) }
        );
      } catch (err) {
        // Same click arriving twice while the first is still running.
        if (err && (err.type === 'StripeIdempotencyError' || (err.raw && err.raw.type === 'idempotency_error'))) {
          return json(200, { ok: true, status: 'processing' });
        }
        const intent = (err && err.raw && err.raw.payment_intent) || (err && err.payment_intent);
        if (err.code === 'authentication_required' && intent && intent.client_secret) {
          await saveAttempts(leadId, entitlements, product, { ...attemptState, pendingPaymentIntentId: intent.id });
          return json(200, { ok: true, status: 'requires_action', clientSecret: intent.client_secret, paymentIntentId: intent.id });
        }
        const isCardError = !!(err && (
          err.type === 'StripeCardError' ||
          (err.raw && err.raw.type === 'card_error') ||
          err.code === 'card_declined' ||
          err.decline_code
        ));
        const declineDetails = safeDeclineLog(err, product, def, leadId);
        console.error('charge-upsell decline', declineDetails);
        await logFunnelEvent('upsell_failed', { lead_id: leadId, detail: { product, reason: safeDeclineReason(err), amount: def.amount } });
        if (!isCardError) {
          // Stripe/API problem, not the customer's card: don't burn an attempt.
          return json(200, { ok: true, status: 'failed', reason: 'error', message: 'We couldn’t reach the payment processor. Please try again in a moment.' });
        }
        attemptState = attempts.afterFailure(attemptState, attempts.declineCodeFromError(err));
        await saveAttempts(leadId, entitlements, product, attemptState);
        return json(200, attempts.failureResponse(attemptState));
      }
    }

    if (pi.status === 'succeeded') {
      const patch = { [def.field]: true, ...attempts.clearedAttemptsPatch(entitlements, product) };
      if (def.legacyField) patch[def.legacyField] = true;
      if (manychatContactId) {
        patch.manychat_contact_id = manychatContactId;
        patch.manychatContactId = manychatContactId;
      }
      if (def.category) patch.addPurchasedCategory = def.category;
      let warning = null;
      try {
        await patchEntitlements(leadId, patch);
      } catch (err) {
        warning = 'Purchase succeeded, but access status could not be saved immediately.';
        console.error('charge-upsell entitlement patch error', err);
      }
      if (def.category && def.sendDownloadEmail !== false) {
        try {
          await sendDownloadEmail(leadId, def.category);
        } catch (err) {
          console.error('charge-upsell download email error', err);
        }
      }
      await logFunnelEvent('upsell_paid', { lead_id: leadId, payment_id: pi.id, amount: def.amount / 100, detail: { product } });
      return json(200, { ok: true, status: 'succeeded', paymentIntentId: pi.id, warning });
    }

    if (pi.status === 'requires_action') {
      await saveAttempts(leadId, entitlements, product, { ...attemptState, pendingPaymentIntentId: pi.id });
      return json(200, { ok: true, status: 'requires_action', clientSecret: pi.client_secret, paymentIntentId: pi.id });
    }

    if (pi.status === 'processing') {
      return json(200, { ok: true, status: 'processing', paymentIntentId: pi.id });
    }

    const lastError = pi.last_payment_error || {};
    attemptState = attempts.afterFailure(attemptState, lastError.decline_code || lastError.code || 'declined');
    await saveAttempts(leadId, entitlements, product, attemptState);
    return json(200, attempts.failureResponse(attemptState));
  } catch (err) {
    console.error('charge-upsell error', err);
    return json(500, { ok: false, error: 'Could not process this purchase.' });
  }
};
