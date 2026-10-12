// POST /.netlify/functions/create-payment-intent
// Body: { leadId, email, answers }
//
// Kept at the legacy endpoint name so the existing checkout page does not
// need a routing rewrite. It creates a SetupIntent to collect a valid card
// with $0 due today. The actual trial subscription is created only after
// Stripe confirms that SetupIntent (and the card passes screening — see
// _lib/card-screening.js and confirm-intent.js).
//
// Requires the signed session cookie for this lead (issued by submit-lead or
// a signed email link). The only exception is a brand-new lead that has never
// been claimed and has no card/payment on file (e.g. the questionnaire's save
// request failed on a bad connection) — that lead is claimed here, and the
// cookie is issued, so nobody else can use it afterwards.
const { getStripe } = require('./_lib/stripe');
const { readSession, issueSessionCookie, withCookie } = require('./_lib/session');
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
  const metadata = {
    email: cleanMetadataValue(email, 160),
  };
  if (firstName) metadata.first_name = firstName;
  if (lastName) metadata.last_name = lastName;
  if (fullName) metadata.full_name = fullName;

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

const REUSABLE_SETUP_STATUSES = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);

function canBootstrapLead(existingLead, entitlements) {
  if (!existingLead) return true;
  const e = entitlements || {};
  return !e.sessionClaimedAt && !e.paid10 && !e.defaultPaymentMethodId;
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
    const existingLead = await getLead(normalizedLeadId).catch(() => null);
    const existingEntitlements = await getEntitlements(normalizedLeadId).catch(() => null);

    const session = readSession(event);
    const ownsLead = !!(session && session.leadId === normalizedLeadId);
    if (!ownsLead && !canBootstrapLead(existingLead, existingEntitlements)) {
      return {
        statusCode: 401,
        body: JSON.stringify({
          ok: false,
          code: 'session_required',
          error: 'Your secure session has expired. Please reopen your RentReady link or start again.',
        }),
      };
    }
    const sessionCookie = issueSessionCookie(event, normalizedLeadId, 'lead');

    if (existingEntitlements && existingEntitlements.paid10 &&
        ['active', 'trialing'].includes(String(existingEntitlements.listingSubscriptionStatus || '').toLowerCase())) {
      return withCookie({
        statusCode: 409,
        body: JSON.stringify({ ok: false, code: 'already_active', error: 'Your RentReady access is already active.' }),
      }, sessionCookie);
    }

    const stripe = getStripe();
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

    // Reuse this lead's still-open SetupIntent (page refresh), but never one
    // that already finished or whose card was rejected — the old fixed
    // idempotency key handed back the same completed SetupIntent forever, so
    // a customer could not switch to a different card.
    const previousSetupIntentId = existingEntitlements && existingEntitlements.listingSetupIntentId;
    let setupIntent = null;
    if (previousSetupIntentId) {
      const previous = await stripe.setupIntents.retrieve(previousSetupIntentId).catch(() => null);
      if (
        previous &&
        REUSABLE_SETUP_STATUSES.has(previous.status) &&
        previous.customer === customer.id &&
        previous.id !== (existingEntitlements && existingEntitlements.rejectedSetupIntentId)
      ) {
        setupIntent = previous;
      }
    }
    if (!setupIntent) {
      // Key on the last SetupIntent this lead used (open, finished, or
      // rejected) so simultaneous requests share one SetupIntent, while every
      // new card attempt after a rejection gets a brand-new one.
      const lastSetupIntentId =
        previousSetupIntentId ||
        (existingEntitlements && existingEntitlements.rejectedSetupIntentId) ||
        'none';
      const setupPayload = {
        customer: customer.id,
        payment_method_types: ['card'],
        usage: 'off_session',
        metadata: { ...metadata, product: 'listing_membership', plan: 'trial_then_monthly' },
      };
      setupIntent = await stripe.setupIntents.create(
        setupPayload,
        { idempotencyKey: `${normalizedLeadId}:listing-setup-intent:after-${lastSetupIntentId}` }
      );
      if (!REUSABLE_SETUP_STATUSES.has(setupIntent.status)) {
        // Defensive: never hand the browser a SetupIntent that is already used.
        setupIntent = await stripe.setupIntents.create(setupPayload);
      }
    }
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
        ...(!(existingEntitlements && existingEntitlements.sessionClaimedAt) ? { sessionClaimedAt: new Date().toISOString() } : {}),
        stripeCustomerId: customer.id,
        listingSetupIntentId: setupIntent.id,
        listingSubscriptionStatus: 'setup_pending',
        listingAccessStatus: 'inactive',
        ...(manychatContactId ? { manychat_contact_id: manychatContactId, manychatContactId } : {}),
      });
    } catch (err) {
      console.warn('pre-payment lead save failed', err);
    }

    return withCookie({
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        intentType: 'setup',
      }),
    }, sessionCookie);
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
