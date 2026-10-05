// POST /.netlify/functions/create-payment-intent
// Body: { leadId, email, answers }
//
// Kept at the legacy endpoint name so the existing checkout page does not
// need a routing rewrite. It creates the listing subscription with a 7-day
// trial plus a $1 card-verification invoice due today, then returns that
// invoice PaymentIntent client secret for the existing card form to confirm.
const { getStripe } = require('./_lib/stripe');
const { saveLead, getLead, getEntitlements, patchEntitlements } = require('./_lib/store');
const { normalizeEmail, isValidEmail } = require('./_lib/email');
const { normalizeManyChatContactId, manychatMetadata } = require('./_lib/manychat');

function listingPriceId() {
  return (
    process.env.STRIPE_LISTING_PRICE_MONTHLY ||
    process.env.STRIPE_PRICE_LISTING_MONTHLY ||
    process.env.STRIPE_RENTREADY_LISTING_PRICE_MONTHLY ||
    ''
  ).trim();
}

async function findCustomerByLeadId(stripe, leadId) {
  try {
    const existing = await stripe.customers.search({
      query: `metadata['leadId']:'${leadId.replace(/'/g, '')}'`,
      limit: 1,
    });
    return existing.data[0] || null;
  } catch (err) {
    // A search issue should not stop a fresh checkout from starting. Creating
    // a new customer is safer than blocking checkout activation.
    console.warn('customer search failed, creating a new customer', err);
    return null;
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

  const { leadId, email, answers } = body;
  const normalizedLeadId = String(leadId || '').trim();
  if (!normalizedLeadId) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'leadId is required' }) };
  }
  const normalizedEmail = normalizeEmail(email || (answers && answers.email));
  if (!isValidEmail(normalizedEmail)) {
    return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'A valid email address is required.' }) };
  }

  try {
    const stripe = getStripe();
    const priceId = listingPriceId();
    if (!priceId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: 'STRIPE_LISTING_PRICE_MONTHLY is not configured.' }),
      };
    }
    const existingLead = await getLead(normalizedLeadId).catch(() => null);
    const existingEntitlements = await getEntitlements(normalizedLeadId).catch(() => null);
    const manychatContactId = normalizeManyChatContactId(
      (answers && (answers.manychat_contact_id || answers.manychatContactId)) ||
      (existingLead && existingLead.manychat_contact_id)
    );
    const metadata = { leadId: normalizedLeadId, ...manychatMetadata(manychatContactId) };

    // Reuse an existing Stripe Customer for this leadId if one exists
    // (e.g. the customer refreshed the page after the intent was created
    // but before paying), otherwise create a new one.
    const existing = existingEntitlements && existingEntitlements.stripeCustomerId
      ? await stripe.customers.retrieve(existingEntitlements.stripeCustomerId).catch(() => null)
      : await findCustomerByLeadId(stripe, normalizedLeadId);
    const customer =
      (existing && !existing.deleted ? existing : null) ||
      (await stripe.customers.create({
        email: normalizedEmail,
        metadata,
      }));
    if (existing && manychatContactId && (!existing.metadata || existing.metadata.manychat_contact_id !== manychatContactId)) {
      await stripe.customers.update(existing.id, { metadata: { ...(existing.metadata || {}), ...metadata } });
    }

    const subscription = await stripe.subscriptions.create(
      {
        customer: customer.id,
        items: [{ price: priceId }],
        add_invoice_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: 100,
              product_data: {
                name: 'RentReady card verification',
              },
            },
            metadata: { ...metadata, product: 'listing_membership_verification', plan: 'trial' },
          },
        ],
        trial_period_days: 7,
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
        expand: ['latest_invoice.payment_intent'],
        metadata: { ...metadata, product: 'listing_membership', plan: 'trial_then_monthly' },
      },
      { idempotencyKey: `${normalizedLeadId}:listing-subscription:trial-v2` }
    );
    const paymentIntent = subscription.latest_invoice && subscription.latest_invoice.payment_intent;
    if (!paymentIntent || !paymentIntent.client_secret) {
      throw new Error('Stripe did not return a subscription payment client secret.');
    }

    // Save the questionnaire answers server-side so later functions (PDF
    // generation, the $97 relevance check, email delivery) have an
    // authoritative copy instead of trusting whatever the browser sends.
    try {
      if (answers) {
        await saveLead(normalizedLeadId, { ...answers, email: normalizedEmail, ...(manychatContactId ? { manychat_contact_id: manychatContactId } : {}) });
      }
      await patchEntitlements(normalizedLeadId, {
        stripeCustomerId: customer.id,
        listingSubscriptionId: subscription.id,
        listingSubscriptionStatus: subscription.status || 'incomplete',
        listingAccessStatus: 'inactive',
        ...(manychatContactId ? { manychat_contact_id: manychatContactId, manychatContactId } : {}),
      });
    } catch (err) {
      console.warn('pre-payment lead save failed', err);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        subscriptionId: subscription.id,
      }),
    };
  } catch (err) {
    console.error('create-payment-intent error', err);
    const message = err && err.message ? err.message : '';
    const setupError =
      message.includes('STRIPE_SECRET_KEY') ||
      message.includes('Invalid API Key') ||
      message.includes('No API key provided');

    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: setupError ? message : 'Could not start checkout.',
      }),
    };
  }
};
