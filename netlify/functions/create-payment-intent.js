// POST /.netlify/functions/create-payment-intent
// Body: { leadId, email, answers }
//
// Kept at the legacy endpoint name so the existing checkout page does not
// need a routing rewrite. It creates a SetupIntent to collect a valid card
// with $0 due today. The actual trial subscription is created only after
// Stripe confirms that SetupIntent.
//
// Security rules:
//   - A lead with active/trialing listing access never gets a new
//     SetupIntent here, and its Stripe customer, saved card and access are
//     never touched from this endpoint.
//   - Existing lead answers and existing Stripe customers are only modified
//     when this browser's rr_session cookie belongs to that lead.
//   - Each browser gets its OWN SetupIntent (never one shared by leadId), and
//     the response sets rr_session = { leadId, si } for it. If that
//     SetupIntent is the one that saves the card, this browser becomes the
//     verified payer allowed to use the saved card for later upsells.
const { getStripe } = require('./_lib/stripe');
const { saveLead, getLead, getEntitlements, patchEntitlements } = require('./_lib/store');
const { normalizeEmail, isValidEmail } = require('./_lib/email');
const { normalizeManyChatContactId, manychatMetadata } = require('./_lib/manychat');
const { hasActiveListingAccess } = require('./_lib/listing-access');
const { sessionForLead, sessionCookie } = require('./_lib/session');
const { sanitizeLeadAnswers } = require('./_lib/lead-fields');
const rateLimit = require('./_lib/rate-limit');

const REUSABLE_SETUP_STATUSES = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);

function json(statusCode, body, cookie) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
    body: JSON.stringify(body),
  };
}

function idOf(value) {
  if (!value) return null;
  return typeof value === 'object' ? value.id || null : String(value);
}

// Same browser, same unfinished checkout (refresh, second click, second
// tab): hand back the SetupIntent it already has instead of making another.
async function reusableSetupIntent(stripe, session, leadId, customerId) {
  if (!session || !session.si) return null;
  const si = await stripe.setupIntents.retrieve(session.si).catch(() => null);
  if (!si || !REUSABLE_SETUP_STATUSES.has(si.status)) return null;
  if ((si.metadata || {}).leadId !== leadId || (customerId && idOf(si.customer) !== customerId)) return null;
  return si;
}

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
    return json(400, { ok: false, error: 'Invalid JSON body' });
  }

  const { leadId, email } = body;
  const answers = body.answers && typeof body.answers === 'object' ? sanitizeLeadAnswers(body.answers) : null;
  const normalizedLeadId = String(leadId || '').trim();
  if (!normalizedLeadId) {
    return json(400, { ok: false, error: 'leadId is required' });
  }
  const normalizedEmail = normalizeEmail(email || (answers && answers.email));
  if (!isValidEmail(normalizedEmail)) {
    return json(400, { ok: false, error: 'A valid email address is required.' });
  }

  if (!rateLimit.allow([
    { key: `setup:ip:${rateLimit.clientIp(event)}`, limit: 20, windowMs: 60 * 1000 },
    { key: `setup:lead:${normalizedLeadId}`, limit: 15, windowMs: 60 * 1000 },
  ])) {
    return json(429, { ok: false, error: 'Too many attempts. Please wait a minute and try again.' });
  }

  try {
    const stripe = getStripe();
    const session = sessionForLead(event, normalizedLeadId);
    const isOwner = !!session;
    const existingLead = await getLead(normalizedLeadId).catch(() => null);
    const existingEntitlements = await getEntitlements(normalizedLeadId).catch(() => null);

    // Active/trialing members already have a saved card and access. Never
    // start another SetupIntent or touch their customer from here.
    if (existingEntitlements && hasActiveListingAccess(existingEntitlements)) {
      return json(200, { ok: true, alreadyActive: true });
    }

    // Unauthenticated requests may only fill in a brand-new lead; they can
    // never change an existing lead's answers or Stripe customer profile.
    const canWriteLead = !existingLead || isOwner;
    const manychatContactId = normalizeManyChatContactId(
      (canWriteLead && answers && (answers.manychat_contact_id || answers.manychatContactId)) ||
      (existingLead && existingLead.manychat_contact_id)
    );
    const profile = stripeCustomerProfile(canWriteLead ? answers : null, existingLead, normalizedEmail);
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
    if (existing && !existing.deleted && isOwner) {
      // Only the browser that owns this lead may update its Stripe customer.
      await stripe.customers.update(existing.id, {
        email: normalizedEmail,
        ...(profile.name ? { name: profile.name } : {}),
        metadata: { ...(existing.metadata || {}), ...metadata },
      });
    }

    // Stripe's `usage: 'off_session'` only lets the saved card be used later
    // (trial renewals); it is not a charge. Each browser gets its own
    // SetupIntent — a leadId-only idempotency key would hand the same client
    // secret to anyone who knows the leadId.
    const setupIntent =
      (await reusableSetupIntent(stripe, session, normalizedLeadId, customer.id)) ||
      (await stripe.setupIntents.create({
        customer: customer.id,
        payment_method_types: ['card'],
        usage: 'off_session',
        metadata: { ...metadata, product: 'listing_membership', plan: 'trial_then_monthly' },
      }));
    if (!setupIntent || !setupIntent.client_secret) {
      throw new Error('Stripe did not return a setup client secret.');
    }

    // Save the questionnaire answers server-side so later functions (PDF
    // generation, the $97 relevance check, email delivery) have an
    // authoritative copy instead of trusting whatever the browser sends.
    try {
      if (answers && canWriteLead) {
        await saveLead(normalizedLeadId, { ...answers, email: normalizedEmail, ...(manychatContactId ? { manychat_contact_id: manychatContactId } : {}) });
      }
      if (canWriteLead || !(existingEntitlements && existingEntitlements.stripeCustomerId)) {
        await patchEntitlements(normalizedLeadId, {
          stripeCustomerId: customer.id,
          listingSetupIntentId: setupIntent.id,
          listingSubscriptionStatus: 'setup_pending',
          listingAccessStatus: 'inactive',
          ...(manychatContactId ? { manychat_contact_id: manychatContactId, manychatContactId } : {}),
        });
      }
    } catch (err) {
      console.warn('pre-payment lead save failed', err && err.message);
    }

    return json(
      200,
      {
        ok: true,
        clientSecret: setupIntent.client_secret,
        setupIntentId: setupIntent.id,
        intentType: 'setup',
      },
      sessionCookie({ leadId: normalizedLeadId, si: setupIntent.id })
    );
  } catch (err) {
    console.error('create-payment-intent error', err && err.message);
    const message = err && err.message ? err.message : '';
    const setupError =
      message.includes('STRIPE_SECRET_KEY') ||
      message.includes('Invalid API Key') ||
      message.includes('No API key provided');

    return json(500, { ok: false, error: setupError ? message : 'Could not start checkout.' });
  }
};
