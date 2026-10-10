// POST /.netlify/functions/create-payment-intent
// Body: { leadId, email, answers }
//
// Kept at the legacy endpoint name so the existing checkout page does not
// need a routing rewrite. It creates a SetupIntent to collect a valid card
// with $0 due today. The actual trial subscription is created only after
// Stripe confirms that SetupIntent.
const { getStripe } = require('./_lib/stripe');
const { saveLead, getLead, getEntitlements, patchEntitlements } = require('./_lib/store');
const { normalizeEmail, isValidEmail } = require('./_lib/email');
const { normalizeManyChatContactId, manychatMetadata } = require('./_lib/manychat');

function cleanMetadataValue(value, max = 200) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function stripeCustomerProfile(answers, existingLead, email) {
  const source = { ...(existingLead || {}), ...(answers || {}) };
  const firstName = cleanMetadataValue(source.first_name || source.firstName, 80);
  const lastName = cleanMetadataValue(source.last_name || source.lastName, 80);
  const fullName = cleanMetadataValue(
    source.full_name ||
    source.fullName ||
    source.name ||
    [firstName, lastName].filter(Boolean).join(' '),
    160
  );
  const city = cleanMetadataValue(source.preferred_city || source.city || source.searchArea, 120);
  const rentBudget = cleanMetadataValue(source.rent_budget || source.rentBudget, 40);
  const moveTimeline = cleanMetadataValue(source.move_timeline || source.moveTimeline, 80);

  const metadata = {
    email: cleanMetadataValue(email, 160),
  };
  if (firstName) metadata.first_name = firstName;
  if (lastName) metadata.last_name = lastName;
  if (fullName) metadata.full_name = fullName;
  if (city) metadata.preferred_city = city;
  if (rentBudget) metadata.rent_budget = rentBudget;
  if (moveTimeline) metadata.move_timeline = moveTimeline;

  return {
    name: fullName,
    metadata,
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
    const existingLead = await getLead(normalizedLeadId).catch(() => null);
    const existingEntitlements = await getEntitlements(normalizedLeadId).catch(() => null);
    const manychatContactId = normalizeManyChatContactId(
      (answers && (answers.manychat_contact_id || answers.manychatContactId)) ||
      (existingLead && existingLead.manychat_contact_id)
    );
    const profile = stripeCustomerProfile(answers, existingLead, normalizedEmail);
    const metadata = { leadId: normalizedLeadId, ...profile.metadata, ...manychatMetadata(manychatContactId) };

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
        ...(profile.name ? { name: profile.name } : {}),
        metadata,
      }));
    if (existing && !existing.deleted) {
      await stripe.customers.update(existing.id, {
        email: normalizedEmail,
        ...(profile.name ? { name: profile.name } : {}),
        metadata: { ...(existing.metadata || {}), ...metadata },
      });
    }

    const setupIntent = await stripe.setupIntents.create(
      {
        customer: customer.id,
        payment_method_types: ['card'],
        usage: 'off_session',
        metadata: { ...metadata, product: 'listing_membership', plan: 'trial_then_monthly' },
      },
      { idempotencyKey: `${normalizedLeadId}:listing-setup-intent:trial-v1` }
    );
    if (!setupIntent || !setupIntent.client_secret) {
      throw new Error('Stripe did not return a setup client secret.');
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
        listingSetupIntentId: setupIntent.id,
        listingSubscriptionStatus: 'setup_pending',
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
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        intentType: 'setup',
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
