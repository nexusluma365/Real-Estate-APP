const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const script = fs.readFileSync('app/public/assets/checkout-client.js', 'utf8');

function makeStorage(initial = {}) {
  const values = { ...initial };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
    setItem: (key, value) => {
      values[key] = String(value);
    },
  };
}

function makeContext({ confirmOk }) {
  const fetchCalls = [];
  const stripeConfirmCalls = [];
  const sessionStorage = makeStorage({
    rrn_answers_v1: JSON.stringify({ lead_id: 'lead_123' }),
  });
  const localStorage = makeStorage();
  const context = {
    console,
    Blob: class Blob {},
    crypto: { randomUUID: () => 'idem_3ds' },
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }),
      querySelector: () => null,
      head: { appendChild() {} },
      body: { appendChild() {} },
    },
    navigator: {},
    sessionStorage,
    localStorage,
    Stripe: (key) => {
      assert.equal(key, 'pk_live_test');
      return {
        confirmCardPayment: async (clientSecret) => {
          stripeConfirmCalls.push(clientSecret);
          return { paymentIntent: { id: 'pi_3ds', status: 'succeeded' } };
        },
      };
    },
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, body: options.body ? JSON.parse(options.body) : null });
      if (String(url).includes('/config')) {
        return { ok: true, json: async () => ({ ok: true, stripePublishableKey: 'pk_live_test' }) };
      }
      if (String(url).includes('/charge-upsell')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            status: 'requires_action',
            clientSecret: 'pi_3ds_secret',
            paymentIntentId: 'pi_3ds',
          }),
        };
      }
      if (String(url).includes('/confirm-intent')) {
        return {
          ok: confirmOk,
          json: async () => (confirmOk ? { ok: true, status: 'succeeded' } : { ok: false, error: 'verification failed' }),
        };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  context.window = context;
  vm.runInNewContext(script, context);
  return { context, fetchCalls, stripeConfirmCalls };
}

async function run() {
  const success = makeContext({ confirmOk: true });
  const successStatus = await success.context.rrnChargeUpsell('apartment_prep');
  assert.equal(successStatus, 'succeeded');
  assert.deepEqual(success.stripeConfirmCalls, ['pi_3ds_secret']);
  assert.ok(success.fetchCalls.some((call) => String(call.url).includes('/confirm-intent')));
  assert.equal(success.context.rrnApartmentPaymentIntentId('apartment_prep'), 'pi_3ds');

  const verifyFailed = makeContext({ confirmOk: false });
  const failedStatus = await verifyFailed.context.rrnChargeUpsell('apartment_prep');
  assert.equal(failedStatus, 'failed');
  assert.deepEqual(verifyFailed.stripeConfirmCalls, ['pi_3ds_secret']);
  assert.equal(verifyFailed.context.rrnApartmentPaymentIntentId('apartment_prep'), 'pi_3ds');
}

run()
  .then(() => console.log('checkout client 3ds flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
