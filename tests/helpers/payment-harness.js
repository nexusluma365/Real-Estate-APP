// In-memory Stripe + store fakes for exercising the real payment functions
// end to end — no network, no real charges. Models what the production flow
// relies on: SetupIntents that save a card to a customer, the 7-day trial
// subscription on a $19.99/month Price, PaymentIntents that can only succeed
// once, idempotency keys (same key + same params → same result; different
// params → error), card declines, 3-D Secure, and saved cards that only work
// with their own customer. Webhook signing uses the real `stripe` library.
const RealStripe = require('stripe');

const FN = (name) => require.resolve(`../../netlify/functions/${name}`);
const LIB = (name) => require.resolve(`../../netlify/functions/_lib/${name}`);

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const LISTING_PRICE_ID = 'price_listing_1999_test';
const DAY = 24 * 60 * 60;

function createFakeStripe({ cards = {} } = {}) {
  const state = {
    seq: 0,
    intents: new Map(),
    setupIntents: new Map(),
    subscriptions: new Map(),
    customers: new Map(),
    idempotency: new Map(),
    charges: [],
    refunds: [],
    createCalls: [],
    confirmCalls: [],
    setupIntentsCreated: [],
    subscriptionsCreated: [],
    customerUpdates: [],
    authorizations: [],
  };
  const nextId = (prefix) => `${prefix}_${++state.seq}`;

  function cardFor(pm) {
    return cards[pm] || { behavior: 'success', funding: 'credit' };
  }

  function idempotent(key, fingerprint, run) {
    if (!key) return run();
    const hit = state.idempotency.get(key);
    if (hit) {
      if (hit.fingerprint !== fingerprint) {
        const err = new Error('Keys for idempotent requests can only be used with the same parameters they were first used with.');
        err.type = 'StripeIdempotencyError';
        throw err;
      }
      if (hit.error) throw hit.error;
      return clone(hit.result);
    }
    try {
      const result = run();
      state.idempotency.set(key, { fingerprint, result: clone(result) });
      return result;
    } catch (error) {
      state.idempotency.set(key, { fingerprint, error });
      throw error;
    }
  }

  function invalidRequest(message) {
    const err = new Error(message);
    err.type = 'StripeInvalidRequestError';
    return err;
  }

  // Applies a card to a PaymentIntent. Returns a StripeCardError on decline.
  function applyCard(pi, pm) {
    const card = cardFor(pm);
    if (card.customer && card.customer !== pi.customer) {
      throw invalidRequest('The provided PaymentMethod belongs to a different Customer.');
    }
    if (pi.status === 'succeeded') throw invalidRequest('This PaymentIntent has already succeeded.');
    pi.payment_method = pm;
    if (card.behavior === 'success') {
      pi.status = 'succeeded';
      pi.last_payment_error = null;
      state.charges.push({ paymentIntentId: pi.id, paymentMethod: pm, amount: pi.amount, product: pi.metadata.product, funding: card.funding || 'credit' });
      return null;
    }
    if (card.behavior === 'requires_action') {
      pi.status = 'requires_action';
      return null;
    }
    const code = ['expired_card', 'incorrect_cvc', 'processing_error'].includes(card.behavior) ? card.behavior : 'card_declined';
    const declineCode = code === 'card_declined' ? card.behavior : undefined;
    pi.status = 'requires_payment_method';
    pi.payment_method = null;
    pi.last_payment_error = {
      type: 'card_error',
      code,
      ...(declineCode ? { decline_code: declineCode } : {}),
      payment_method: { id: pm, card: { funding: card.funding || 'credit' } },
    };
    const err = new Error('Your card was declined.');
    err.type = 'StripeCardError';
    err.code = code;
    err.decline_code = declineCode;
    err.raw = { ...clone(pi.last_payment_error), payment_intent: clone(pi) };
    return err;
  }

  const stripe = {
    paymentIntents: {
      create: async (params, opts = {}) => {
        state.createCalls.push({ params: clone(params), opts: clone(opts) });
        return idempotent(opts.idempotencyKey, JSON.stringify(params), () => {
          const id = nextId('pi');
          const pi = {
            id,
            object: 'payment_intent',
            client_secret: `${id}_secret_test`,
            amount: params.amount,
            currency: params.currency,
            customer: params.customer || null,
            metadata: { ...(params.metadata || {}) },
            description: params.description,
            status: 'requires_payment_method',
            payment_method: null,
            last_payment_error: null,
            off_session: params.off_session,
            capture_method: params.capture_method || 'automatic',
          };
          state.intents.set(id, pi);
          if (params.confirm) {
            const err = applyCard(pi, params.payment_method);
            if (err) throw err;
          }
          return clone(pi);
        });
      },
      retrieve: async (id) => {
        const pi = state.intents.get(id);
        if (!pi) throw invalidRequest(`No such payment_intent: '${id}'`);
        return clone(pi);
      },
      update: async (id, params = {}) => {
        const pi = state.intents.get(id);
        if (!pi) throw invalidRequest(`No such payment_intent: '${id}'`);
        if (params.metadata) pi.metadata = { ...pi.metadata, ...params.metadata };
        if (params.receipt_email) pi.receipt_email = params.receipt_email;
        return clone(pi);
      },
      confirm: async (id, params = {}, opts = {}) => {
        state.confirmCalls.push({ id, params: clone(params), opts: clone(opts) });
        return idempotent(opts.idempotencyKey, JSON.stringify([id, params]), () => {
          const pi = state.intents.get(id);
          if (!pi) throw invalidRequest(`No such payment_intent: '${id}'`);
          const err = applyCard(pi, params.payment_method);
          if (err) throw err;
          return clone(pi);
        });
      },
      cancel: async (id) => {
        const pi = state.intents.get(id);
        pi.status = 'canceled';
        return clone(pi);
      },
    },
    setupIntents: {
      create: async (params, opts = {}) =>
        idempotent(opts.idempotencyKey, JSON.stringify(params), () => {
          const id = nextId('seti');
          const si = {
            id,
            object: 'setup_intent',
            client_secret: `${id}_secret_test`,
            customer: params.customer,
            usage: params.usage,
            metadata: { ...(params.metadata || {}) },
            status: 'requires_payment_method',
            payment_method: null,
          };
          state.setupIntents.set(id, si);
          state.setupIntentsCreated.push(clone(params));
          return clone(si);
        }),
      retrieve: async (id) => {
        const si = state.setupIntents.get(id);
        if (!si) throw invalidRequest(`No such setup_intent: '${id}'`);
        return clone(si);
      },
    },
    prices: {
      retrieve: async (id) => {
        if (id !== LISTING_PRICE_ID) throw invalidRequest(`No such price: '${id}'`);
        return { id, object: 'price', active: true, livemode: false, currency: 'usd', unit_amount: 1999, recurring: { interval: 'month' } };
      },
    },
    subscriptions: {
      create: async (params, opts = {}) =>
        idempotent(opts.idempotencyKey, JSON.stringify(params), () => {
          const id = nextId('sub');
          const now = Math.floor(Date.now() / 1000);
          const trialDays = params.trial_period_days || 0;
          const sub = {
            id,
            object: 'subscription',
            customer: params.customer,
            default_payment_method: params.default_payment_method,
            status: trialDays ? 'trialing' : 'active',
            trial_period_days: trialDays,
            trial_end: trialDays ? now + trialDays * DAY : null,
            current_period_start: now,
            current_period_end: now + (trialDays || 30) * DAY,
            cancel_at_period_end: false,
            metadata: { ...(params.metadata || {}) },
            items: { data: [{ price: { id: params.items[0].price, unit_amount: 1999, currency: 'usd', recurring: { interval: 'month' } } }] },
          };
          state.subscriptions.set(id, sub);
          state.subscriptionsCreated.push({ params: clone(params), opts: clone(opts) });
          return clone(sub);
        }),
      retrieve: async (id) => {
        const sub = state.subscriptions.get(id);
        if (!sub) throw invalidRequest(`No such subscription: '${id}'`);
        return clone(sub);
      },
      cancel: async (id) => {
        const sub = state.subscriptions.get(id);
        if (sub) sub.status = 'canceled';
        return clone(sub || {});
      },
    },
    refunds: {
      create: async (params, opts = {}) =>
        idempotent(opts.idempotencyKey, JSON.stringify(params), () => {
          state.refunds.push({ paymentIntent: params.payment_intent, metadata: clone(params.metadata) });
          return { id: `re_${state.refunds.length}`, payment_intent: params.payment_intent };
        }),
    },
    customers: {
      search: async () => ({ data: [] }),
      retrieve: async (id) => clone(state.customers.get(id) || { id, deleted: true }),
      create: async (params) => {
        const id = nextId('cus');
        state.customers.set(id, { id, ...clone(params) });
        return clone(state.customers.get(id));
      },
      update: async (id, params) => {
        state.customerUpdates.push({ id, params: clone(params) });
        const current = state.customers.get(id) || { id };
        state.customers.set(id, { ...current, ...clone(params) });
        return clone(state.customers.get(id));
      },
    },
    webhooks: new RealStripe('sk_test_harness').webhooks,
  };

  // What Stripe.js does in the browser: confirmCardSetup with a typed card.
  stripe.browserConfirmSetup = (clientSecret, pm) => {
    const si = [...state.setupIntents.values()].find((s) => s.client_secret === clientSecret);
    if (!si) return { error: { type: 'invalid_request_error', message: 'No such SetupIntent' } };
    const card = cardFor(pm);
    // A SetupIntent is a $0 check: even a card with no funds saves fine.
    si.status = 'succeeded';
    si.payment_method = pm;
    cards[pm] = { ...card, customer: si.customer };
    return { setupIntent: clone(si) };
  };
  // What Stripe.js does in the browser: confirmCardPayment with a typed card.
  stripe.browserConfirm = (clientSecret, pm) => {
    const pi = [...state.intents.values()].find((p) => p.client_secret === clientSecret);
    if (!pi) return { error: { type: 'invalid_request_error', message: 'No such PaymentIntent' } };
    try {
      const err = applyCard(pi, pm);
      if (err) return { error: clone(err.raw) };
    } catch (err) {
      return { error: { type: 'invalid_request_error', message: err.message } };
    }
    return { paymentIntent: clone(pi) };
  };
  // The customer completes (or fails) the bank's 3-D Secure challenge.
  stripe.completeAction = (id, success = true) => {
    const pi = state.intents.get(id);
    if (success) {
      pi.status = 'succeeded';
      state.charges.push({ paymentIntentId: pi.id, paymentMethod: pi.payment_method, amount: pi.amount, product: pi.metadata.product });
    } else {
      pi.status = 'requires_payment_method';
      pi.last_payment_error = { type: 'card_error', code: 'payment_intent_authentication_failure', payment_method: { id: pi.payment_method } };
      pi.payment_method = null;
    }
    return clone(pi);
  };
  stripe.state = state;
  stripe.cards = cards;
  return stripe;
}

function defaultEntitlements(leadId) {
  return {
    leadId,
    paid10: false,
    paid27: false,
    paid47: false,
    paid97: false,
    membershipStatus: 'inactive',
    membershipPlan: null,
    purchasedCategory: null,
    purchasedCategories: [],
    stripeCustomerId: null,
    listingSubscriptionId: null,
    listingSubscriptionStatus: 'inactive',
    listingAccessStatus: 'inactive',
    defaultPaymentMethodId: null,
  };
}

// Mirrors store.js merge semantics (addPurchasedCategory is a set-add).
function createFakeStore({ entitlements = {}, leads = {} } = {}) {
  const ents = new Map(Object.entries(entitlements).map(([id, e]) => [id, { ...defaultEntitlements(id), ...clone(e) }]));
  const leadMap = new Map(Object.entries(leads).map(([id, l]) => [id, clone(l)]));
  const patches = [];
  const savedLeads = [];
  const fake = {
    patches,
    savedLeads,
    ents,
    leadMap,
    failPatches: false,
  };
  fake.exports = {
    getEntitlements: async (leadId) => clone(ents.get(leadId) || defaultEntitlements(leadId)),
    patchEntitlements: async (leadId, patch) => {
      if (fake.failPatches) throw new Error('temporary entitlement write failure');
      patches.push({ leadId, patch: clone(patch) });
      const current = ents.get(leadId) || defaultEntitlements(leadId);
      const { addPurchasedCategory, ...rest } = patch;
      const purchasedCategories = addPurchasedCategory
        ? Array.from(new Set([...(current.purchasedCategories || []), addPurchasedCategory]))
        : current.purchasedCategories || [];
      const next = { ...current, ...rest, purchasedCategories, leadId };
      ents.set(leadId, next);
      return clone(next);
    },
    getLead: async (leadId) => (leadMap.has(leadId) ? { ...clone(leadMap.get(leadId)), lead_id: leadId } : null),
    saveLead: async (leadId, answers) => {
      savedLeads.push({ leadId, answers: clone(answers) });
      leadMap.set(leadId, clone(answers));
    },
    getLeadByEmail: async (email) => {
      for (const [id, lead] of leadMap) if (lead.email === email) return { ...clone(lead), lead_id: id };
      return null;
    },
  };
  return fake;
}

function stub(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

const FUNCTIONS = [
  'charge-upsell',
  'confirm-intent',
  'create-payment-intent',
  'stripe-webhook',
  'submit-lead',
  'create-subscription',
  'download-file',
  'get-entitlements',
];

// Installs fakes and returns freshly-loaded handlers bound to them.
function setup({ cards, entitlements, leads, focus = 'income' } = {}) {
  process.env.EMAIL_LINK_SECRET = process.env.EMAIL_LINK_SECRET || 'harness-session-secret';
  process.env.STRIPE_SECRET_KEY = 'sk_test_harness_not_real';
  process.env.STRIPE_LISTING_PRICE_MONTHLY = LISTING_PRICE_ID;
  delete process.env.GOOGLE_SCRIPT_URL;
  const stripe = createFakeStripe({ cards });
  const store = createFakeStore({ entitlements, leads });
  const emails = { welcome: [], download: [] };
  const funnel = [];

  stub(LIB('stripe'), { getStripe: () => stripe });
  stub(LIB('store'), store.exports);
  stub(LIB('welcome-email'), { sendWelcomeEmail: async (leadId) => { emails.welcome.push(leadId); return true; } });
  stub(LIB('download-email'), { sendDownloadEmail: async (leadId, product) => { emails.download.push({ leadId, product }); return true; } });
  stub(LIB('funnel'), { logFunnelEvent: async (event, fields) => { funnel.push({ event, ...clone(fields) }); return true; } });
  stub(LIB('focus'), { determineFocus: () => focus });
  require('../../netlify/functions/_lib/rate-limit').reset();

  const handlers = {};
  for (const name of FUNCTIONS) {
    delete require.cache[FN(name)];
    handlers[name] = require(FN(name)).handler;
  }
  return { stripe, store, emails, funnel, handlers };
}

function cookieFrom(res) {
  const header = res && res.headers && res.headers['Set-Cookie'];
  return header ? header.split(';')[0] : '';
}

function post(handler, body, { cookie, ip } = {}) {
  return handler({
    httpMethod: 'POST',
    headers: { ...(cookie ? { cookie } : {}), ...(ip ? { 'x-nf-client-connection-ip': ip } : {}) },
    body: JSON.stringify(body),
  }).then((res) => ({ ...res, json: JSON.parse(res.body || '{}') }));
}

// Runs the real production signup: questionnaire submit → $0 SetupIntent
// → card saved in the browser → confirm-intent starts the 7-day trial.
async function completeSignup(h, { leadId = 'lead_a', email = 'renter@example.com', pm = 'pm_saved' } = {}) {
  const submitted = await post(h.handlers['submit-lead'], { lead_id: leadId, email, first_name: 'Rae', last_name: 'Jordan', preferred_city: 'Austin, TX' });
  let cookie = cookieFrom(submitted);
  const intent = await post(h.handlers['create-payment-intent'], { leadId, email, answers: { lead_id: leadId, email, first_name: 'Rae', last_name: 'Jordan' } }, { cookie });
  cookie = cookieFrom(intent) || cookie;
  const browser = h.stripe.browserConfirmSetup(intent.json.clientSecret, pm);
  const confirmed = await post(h.handlers['confirm-intent'], { leadId, setupIntentId: intent.json.setupIntentId, product: 'prescreen' }, { cookie });
  return { cookie, submitted, intent, browser, confirmed };
}

module.exports = { setup, post, cookieFrom, completeSignup, LISTING_PRICE_ID };
