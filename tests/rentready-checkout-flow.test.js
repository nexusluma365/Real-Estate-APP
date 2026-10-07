const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(
  path.join(root, 'app/src/pages/RentreadyReviewCheckout/script-0.js'),
  'utf8'
);

if (!script) {
  throw new Error('Checkout inline script was not found');
}

assert.match(script, /Your payment didn't go through\. Please check your card details and try again\./);

function createElement(id) {
  const classes = new Set();
  return {
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    disabled: true,
    listeners: {},
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      toggle(name, force) {
        const shouldAdd = force === undefined ? !classes.has(name) : !!force;
        if (shouldAdd) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
  };
}

async function waitFor(check, label) {
  for (let i = 0; i < 25; i += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function createCheckoutHarness(opts = {}) {
  const elementsById = {};
  [
    'paymentError',
    'setupNote',
    'summaryCity',
    'summaryMove',
    'checkoutTitle',
    'payBtn',
    'cardNumber',
    'cardExpiry',
    'cardCvc',
    'billingZip',
  ].forEach((id) => {
    elementsById[id] = createElement(id);
  });

  const storage = {
    rrn_answers_v1: JSON.stringify({
      lead_id: 'lead_123',
      email: 'test@example.com',
      first_name: 'Test',
      last_name: 'Applicant',
      preferred_city: 'High Point',
      move_timeline: 'flexible',
      credit_score: '620_659',
    }),
  };
  const mounted = [];
  const focused = [];
  const requests = [];
  const gtagEvents = [];
  let confirmCalls = 0;
  const context = {
    console,
    setTimeout(fn) {
      fn();
      return 1;
    },
    document: {
      getElementById(id) {
        return elementsById[id] || null;
      },
    },
    sessionStorage: {
      getItem(key) {
        return storage[key] || null;
      },
      setItem(key, value) {
        storage[key] = value;
      },
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
    },
    Stripe(key) {
      assert.match(key, /^pk_(test|live)_/);
      return {
        elements() {
          return {
            create(type) {
              return {
                focus() {
                  focused.push(type);
                },
                mount(selector) {
                  mounted.push({ type, selector });
                },
                on() {},
              };
            },
          };
        },
        async confirmCardSetup(clientSecret, paymentOptions) {
          if (opts.cardError) return { error: opts.cardError };
          assert.equal(clientSecret, 'seti_test_secret');
          assert.equal(paymentOptions.payment_method.billing_details.name, 'Test Applicant');
          assert.equal(paymentOptions.payment_method.billing_details.address.postal_code, '12345');
          if (opts.failCardSetup) return { error: { code: 'incorrect_cvc' } };
          return { setupIntent: { id: 'seti_test', status: 'succeeded' } };
        },
      };
    },
    fetch: async (url, reqOptions = {}) => {
      requests.push({ url, options: reqOptions });
      if (String(url).includes('get-entitlements')) {
        return { ok: true, json: async () => ({ ok: true, paid10: false }) };
      }
      if (String(url).includes('config')) {
        if (opts.configUnavailable) {
          return { ok: false, json: async () => ({ ok: false, error: 'STRIPE_PUBLISHABLE_KEY is not configured.' }) };
        }
        return { ok: true, json: async () => ({ ok: true, stripePublishableKey: 'pk_live_checkout', googleAds: { id: 'AW-test', purchaseLabel: 'trial' } }) };
      }
      if (String(url).includes('create-payment-intent')) {
        return {
          ok: true,
          json: async () => ({ ok: true, clientSecret: 'seti_test_secret', setupIntentId: 'seti_test' }),
        };
      }
      if (String(url).includes('get-apartment-results')) {
        return {
          ok: true,
          json: async () => ({ ok: true, properties: [{ name: 'Second-Chance Match', area: 'High Point', image: '', screeningVerification: { is_second_chance_verified: true } }] }),
        };
      }
      if (String(url).includes('confirm-intent')) {
        confirmCalls += 1;
        if (opts.confirmFailure) {
          return { ok: false, json: async () => ({ ok: false, error: 'Netlify timeout' }) };
        }
        if (opts.confirmSequence && opts.confirmSequence.length) {
          const next = opts.confirmSequence.shift();
          return next;
        }
        return { ok: true, json: async () => ({ ok: true, status: 'succeeded', subscriptionId: 'sub_checkout', subscriptionStatus: 'trialing' }) };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  context.window = {
    Stripe: context.Stripe,
    location: {
      href: '',
      replace(url) {
        this.href = url;
      },
    },
    gtag() {
      gtagEvents.push(Array.from(arguments));
    },
  };
  context.window.rrnTestContext = context;

  vm.createContext(context);
  vm.runInContext(script, context);

  return { elementsById, storage, mounted, focused, requests, context, gtagEvents, get confirmCalls() { return confirmCalls; } };
}

async function runSuccessfulCheckout() {
  const harness = createCheckoutHarness();
  const { elementsById, storage, mounted, focused, requests, context, gtagEvents } = harness;

  await waitFor(() => mounted.length === 3 && elementsById.payBtn.disabled === false, 'card fields to mount');

  assert.deepEqual(
    mounted.map((entry) => entry.type),
    ['cardNumber', 'cardExpiry', 'cardCvc']
  );
  elementsById.cardNumber.listeners.click();
  assert.deepEqual(focused, ['cardNumber']);
  assert.equal(
    requests.some((request) => String(request.url).includes('create-payment-intent')),
    false,
    'Subscription checkout should not be created before the user clicks the CTA'
  );

  elementsById.billingZip.value = '12345';
  await elementsById.payBtn.listeners.click();

  assert.equal(
    requests.some((request) => String(request.url).includes('create-payment-intent')),
    true,
    'Subscription checkout should be created when the user clicks the CTA'
  );
  assert.equal(
    JSON.parse(storage.rrn_flow_access_v1).step,
    'prescreen-results',
    'Successful payment should grant results access'
  );
  assert.equal(context.window.location.href, '/after-payment-results/');
  assert.equal(harness.confirmCalls, 1);
  assert.ok(gtagEvents.some((event) => event[1] === 'conversion'), 'Google conversion should fire after subscription confirmation');
}

async function runSubscriptionFailureDoesNotGrantAccess() {
  const harness = createCheckoutHarness({ confirmFailure: true });
  const { elementsById, storage, mounted, requests, context } = harness;
  await waitFor(() => mounted.length === 3 && elementsById.payBtn.disabled === false, 'card fields to mount');

  elementsById.billingZip.value = '12345';
  await elementsById.payBtn.listeners.click();

  assert.equal(harness.confirmCalls, 3, 'Saved-card subscription confirmation should retry conservatively');
  assert.equal(storage.rrn_flow_access_v1, undefined, 'Failed subscription confirmation must not grant results access');
  assert.equal(context.window.location.href, '');
  assert.match(elementsById.paymentError.textContent, /saved your card/i);
  assert.equal(
    requests.filter((request) => String(request.url).includes('create-payment-intent')).length,
    1,
    'Retrying subscription confirmation must not create another SetupIntent'
  );
}

async function runConfigUnavailableStopsCheckout() {
  const harness = createCheckoutHarness({ configUnavailable: true });
  const { elementsById, mounted } = harness;
  await waitFor(() => elementsById.setupNote.classList.contains('show'), 'safe setup failure');

  assert.equal(mounted.length, 0);
  assert.equal(elementsById.payBtn.disabled, true);
  assert.equal(elementsById.setupNote.textContent, 'Checkout is temporarily unavailable. Please try again.');
}

async function run() {
  await runSuccessfulCheckout();
  await runSubscriptionFailureDoesNotGrantAccess();
  await runConfigUnavailableStopsCheckout();
}

run()
  .then(() => console.log('rentready checkout flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
