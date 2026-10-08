// POST /.netlify/functions/charge-upsell
// Body: { leadId, product, idempotencyKey }   product: 'modern'|'luxury'|'apartment_prep'|'gameplan'|'creditkit'
//
// This is the actual "one click" purchase: no card form, no redirect —
// it charges the payment method saved during listing trial checkout. It only
// runs when the customer presses the disclosed-price button on the page;
// nothing here fires on page load, scroll, or navigation.
const { getStripe } = require('./_lib/stripe');
const { getEntitlements, getLead, patchEntitlements } = require('./_lib/store');
const { determineFocus } = require('./_lib/focus');
const { sendDownloadEmail } = require('./_lib/download-email');
const { normalizeManyChatContactId, manychatMetadata } = require('./_lib/manychat');
const { logFunnelEvent } = require('./_lib/funnel');

const PRODUCTS = {
  gameplan: { amount: 2700, field: 'paid27', label: 'RentReady Game Plan' },
  modern: { amount: 2700, field: 'paid27', label: 'RentReady Modern Apartment Matches & RentReady Guide', category: 'modern' },
  luxury: { amount: 2700, field: 'paid27', label: 'RentReady Luxury Apartment Matches & RentReady Guide', category: 'luxury' },
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

  const { leadId, product, idempotencyKey, prescreenPaymentIntentId } = body;
  const def = PRODUCTS[product];
  if (!leadId || !def || !idempotencyKey) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing or invalid fields' }) };
  }

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
      return {
        statusCode: 403,
        body: JSON.stringify({ ok: false, error: 'Complete the listing access checkout before this step.' }),
      };
    }

    // Already-purchased is a no-op success, not a second charge. A customer
    // can own more than one apartment category, so this checks membership
    // in the full set, not equality against the single most-recent one.
    const alreadyHasField = entitlements[def.field] || (def.legacyField && entitlements[def.legacyField]);
    if (alreadyHasField && (!def.category || (entitlements.purchasedCategories || []).includes(def.category))) {
      if (def.category && def.sendDownloadEmail !== false) {
        try {
          await sendDownloadEmail(leadId, def.category);
        } catch (err) {
          console.error('charge-upsell download email error', err);
        }
      }
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'succeeded', alreadyOwned: true }) };
    }

    // Server-side relevance guard for the conditional $97 offer — a
    // customer can't unlock it just by hitting this endpoint if their own
    // answers don't indicate a credit/history issue worth reviewing.
    if (product === 'creditkit') {
      if (!lead || determineFocus(lead) !== 'credit') {
        return {
          statusCode: 400,
          body: JSON.stringify({ ok: false, error: 'This offer is not relevant to your results.' }),
        };
      }
    }

    let pi;
    try {
      const paymentIntentPayload = {
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
      };
      if (product !== 'apartment_prep') {
        paymentIntentPayload.off_session = true;
      }
      pi = await stripe.paymentIntents.create(
        paymentIntentPayload,
        { idempotencyKey: `${leadId}:${product}:${idempotencyKey}` }
      );
    } catch (err) {
      if (err.code === 'authentication_required' && err.raw && err.raw.payment_intent) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            ok: true,
            status: 'requires_action',
            clientSecret: err.raw.payment_intent.client_secret,
            paymentIntentId: err.raw.payment_intent.id,
          }),
        };
      }
      const declineDetails = safeDeclineLog(err, product, def, leadId);
      console.error('charge-upsell decline', declineDetails);
      await logFunnelEvent('upsell_failed', { lead_id: leadId, detail: { product, reason: safeDeclineReason(err), amount: def.amount } });
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          status: 'failed',
          message: product === 'apartment_prep'
            ? 'We couldn\u2019t complete the $20 purchase with this card.'
            : 'We couldn\u2019t complete this purchase with your saved payment method.',
        }),
      };
    }

    if (pi.status === 'succeeded') {
      const patch = { [def.field]: true };
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
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'succeeded', paymentIntentId: pi.id, warning }) };
    }

    if (pi.status === 'requires_action') {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, status: 'requires_action', clientSecret: pi.client_secret, paymentIntentId: pi.id }),
      };
    }

    if (pi.status === 'processing') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'processing', paymentIntentId: pi.id }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, status: 'failed' }) };
  } catch (err) {
    console.error('charge-upsell error', err);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Could not process this purchase.' }) };
  }
};
