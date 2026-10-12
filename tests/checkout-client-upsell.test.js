// Runs the real app/public/assets/checkout-client.js in a sandbox to check
// the browser side of the upsell flow agrees with charge-upsell's response
// shapes: one-click success, 3-D Secure, decline → alternate card, cancel.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '../app/public/assets/checkout-client.js'), 'utf8');

function makeDom() {
  const registry = {};
  class El {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.listeners = {};
      this.textContent = '';
      this.disabled = false;
      this.style = {};
      this.classList = { add() {}, remove() {}, toggle() {} };
      this.queries = {};
      this.removed = false;
    }
    set innerHTML(html) { this.html = html; }
    get innerHTML() { return this.html || ''; }
    querySelector(sel) { return (this.queries[sel] = this.queries[sel] || new El(sel)); }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    setAttribute() {}
    appendChild(child) { this.children.push(child); if (child.id) registry[child.id] = child; return child; }
    remove() { this.removed = true; if (this.id && registry[this.id] === this) delete registry[this.id]; }
  }
  const document = {
    head: new El('head'),
    body: new El('body'),
    createElement: (tag) => new El(tag),
    getElementById: (id) => registry[id] || null,
  };
  return { document, registry };
}

function load({ responses, confirmResults = [], config = { ok: true, stripePublishableKey: 'pk_test_cfg' } }) {
  const { document, registry } = makeDom();
  const fetchCalls = [];
  const stripeCalls = [];
  const storage = new Map([['rrn_answers_v1', JSON.stringify({ lead_id: 'lead_123' })]]);
  const sessionStorage = { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) };
  const context = {
    console,
    document,
    sessionStorage,
    localStorage: sessionStorage,
    crypto: { randomUUID: () => 'uuid' },
    URLSearchParams,
    location: { search: '' },
    navigator: {},
    setTimeout,
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      if (url.includes('/config')) return { ok: !!config.ok, json: async () => config };
      const key = Object.keys(responses).find((k) => url.includes(k));
      const body = typeof responses[key] === 'function' ? responses[key]() : responses[key];
      return { ok: true, json: async () => body };
    },
  };
  context.window = context;
  context.Stripe = (key) => ({
    key,
    elements: () => ({ create: () => ({ mount() {}, on() {}, destroy() {} }) }),
    confirmCardPayment: async (secret, data) => {
      stripeCalls.push({ key, secret, data });
      return confirmResults.shift() || { error: { type: 'card_error', code: 'card_declined' } };
    },
  });
  vm.runInNewContext(SOURCE, context);
  return { window: context, fetchCalls, stripeCalls, registry };
}

async function waitFor(fn) {
  for (let i = 0; i < 200; i += 1) {
    const value = fn();
    if (value) return value;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('timed out');
}

test('one-click success sends only leadId + product, with cookies', async () => {
  const c = load({ responses: { 'charge-upsell': { ok: true, status: 'succeeded', paymentIntentId: 'pi_1' } } });
  assert.equal(await c.window.rrnChargeUpsell('modern'), 'succeeded');
  assert.equal(c.fetchCalls.length, 1);
  assert.deepEqual(c.fetchCalls[0].body, { leadId: 'lead_123', product: 'modern' });
  assert.equal(c.fetchCalls[0].options.credentials, 'same-origin');
});

test('3-D Secure: Stripe.js authenticates, then the server verifies', async () => {
  const c = load({
    responses: {
      'charge-upsell': { ok: true, status: 'requires_action', clientSecret: 'pi_2_secret', paymentIntentId: 'pi_2', amount: 2000 },
      'confirm-intent': { ok: true, status: 'succeeded' },
    },
    confirmResults: [{ paymentIntent: { id: 'pi_2', status: 'succeeded' } }],
  });
  assert.equal(await c.window.rrnChargeUpsell('luxury'), 'succeeded');
  assert.equal(c.stripeCalls[0].secret, 'pi_2_secret');
  assert.equal(c.stripeCalls[0].key, 'pk_test_cfg');
  const confirm = c.fetchCalls.find((f) => f.url.includes('confirm-intent'));
  assert.deepEqual(confirm.body, { leadId: 'lead_123', paymentIntentId: 'pi_2', product: 'luxury' });
});

test('decline → alternate card form → retry after a second decline → success', async () => {
  const c = load({
    responses: {
      'charge-upsell': {
        ok: true,
        status: 'requires_payment_method',
        clientSecret: 'pi_3_secret',
        paymentIntentId: 'pi_3',
        amount: 2000,
        decline: { code: 'insufficient_funds', message: 'Your card was declined for insufficient funds. You can try a different card.' },
        savedCard: true,
      },
      'confirm-intent': { ok: true, status: 'succeeded' },
    },
    confirmResults: [
      { error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds' } },
      { paymentIntent: { id: 'pi_3', status: 'succeeded' } },
    ],
  });
  const pending = c.window.rrnChargeUpsell('gameplan');
  const modal = await waitFor(() => c.registry.rrnCardModal);
  assert.equal(modal.querySelector('h4').textContent, 'Use another card');
  assert.match(modal.querySelector('.rrn-card-message').textContent, /insufficient funds/);
  const pay = modal.querySelector('.rrn-card-pay');
  assert.equal(pay.textContent, 'Pay $20');

  await pay.listeners.click();
  assert.match(modal.querySelector('.rrn-card-error').textContent, /insufficient funds/);
  assert.equal(modal.removed, false, 'form stays open for another try');

  await pay.listeners.click();
  assert.equal(await pending, 'succeeded');
  assert.equal(c.stripeCalls.length, 2);
  assert.ok(c.stripeCalls.every((s) => s.secret === 'pi_3_secret'), 'same PaymentIntent every time');
  assert.ok(c.stripeCalls[0].data.payment_method.card, 'card comes from the Stripe Element');
  assert.ok(c.fetchCalls.some((f) => f.url.includes('confirm-intent')));
});

test('closing the card form resolves failed and charges nothing', async () => {
  const c = load({
    responses: { 'charge-upsell': { ok: true, status: 'requires_payment_method', clientSecret: 's', paymentIntentId: 'pi_4', amount: 9700, decline: null, savedCard: false } },
  });
  const pending = c.window.rrnChargeUpsell('creditkit');
  const modal = await waitFor(() => c.registry.rrnCardModal);
  assert.equal(modal.querySelector('h4').textContent, 'Enter your card');
  modal.querySelector('.rrn-card-cancel').listeners.click();
  assert.equal(await pending, 'failed');
  assert.equal(c.stripeCalls.length, 0);
  assert.equal(c.fetchCalls.some((f) => f.url.includes('confirm-intent')), false);
});

test('no hardcoded fallback key: if /config fails, the payment does not start', async () => {
  const c = load({
    config: { ok: false, error: 'mismatch' },
    responses: { 'charge-upsell': { ok: true, status: 'requires_action', clientSecret: 's', paymentIntentId: 'pi_5' } },
  });
  assert.equal(await c.window.rrnChargeUpsell('modern', 'pk_live_hardcoded_page_constant'), 'failed');
  assert.equal(c.stripeCalls.length, 0);
});
