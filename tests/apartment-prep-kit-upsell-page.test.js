const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function createElement(id) {
  const classes = new Set();
  return {
    id,
    dataset: {},
    disabled: false,
    textContent: '',
    listeners: {},
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name));
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name));
      },
      contains(name) {
        return classes.has(name);
      },
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    querySelector(selector) {
      if (selector === '.sub') return this.sub;
      if (selector === 'h4') return this.title;
      return null;
    },
  };
}

function makeContext({ chargeStatus }) {
  const timers = [];
  const hrefs = [];
  const grants = [];
  const chargeCalls = [];
  const elements = {
    pageRoot: createElement('pageRoot'),
    learnMoreBtn: createElement('learnMoreBtn'),
    heresHow: createElement('heresHow'),
    sheetScrim: createElement('sheetScrim'),
    sheetCancel: createElement('sheetCancel'),
    sheetConfirm: createElement('sheetConfirm'),
    continueListingsLink: createElement('continueListingsLink'),
    keysCtaBtn: createElement('keysCtaBtn'),
  };
  elements.sheetScrim.sub = createElement('sheetSub');
  elements.sheetScrim.title = createElement('sheetTitle');

  const context = {
    console,
    URLSearchParams,
    document: {
      querySelectorAll: () => [],
      querySelector: (selector) => (selector === '.apartment-prep-page' ? elements.pageRoot : null),
      getElementById: (id) => elements[id] || null,
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    sessionStorage: {
      getItem: (key) =>
        key === 'rrn_answers_v1'
          ? JSON.stringify({ lead_id: 'lead_123', preferred_city: 'Miami' })
          : null,
    },
    localStorage: {
      getItem: () => null,
    },
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    rrnLeadId: () => 'lead_123',
    rrnFetchEntitlements: async () => ({ paid10: true, paid27: false, purchasedCategories: [] }),
    rrnGetStripePublishableKey: async (fallback) => fallback,
    rrnChargeUpsell: async (product) => {
      chargeCalls.push(product);
      return chargeStatus;
    },
    rrnGrantFlowAccess: (step, details) => grants.push({ step, details }),
    window: {
      get location() {
        return this._location;
      },
      _location: {
        hostname: 'werentreadygo.com',
        set href(value) {
          hrefs.push(value);
        },
        get href() {
          return hrefs[hrefs.length - 1] || '';
        },
        replace: (value) => hrefs.push(value),
      },
    },
  };
  context.window.rrnLeadId = context.rrnLeadId;
  context.window.rrnHasRecentFlowAccess = () => true;
  return { context, elements, timers, hrefs, grants, chargeCalls };
}

async function runTimer(timer) {
  const result = timer();
  if (result && typeof result.then === 'function') await result;
}

async function run() {
  const script = fs.readFileSync('app/src/pages/ApartmentApprovalPreparationKit/script-0.js', 'utf8');
  const html = fs.readFileSync('app/src/pages/ApartmentApprovalPreparationKit/page.html', 'utf8');

  assert.match(html, /One-time payment \$20 • Immediate digital access • No subscription/);
  assert.match(html, /Immediate digital access • One-time \$20 • No subscription/);
  assert.match(html, /one-time \$20 charge to the card you have on file/);
  assert.doesNotMatch(html, /\$47/);
  assert.match(script, /complete your \$20 purchase/);
  assert.doesNotMatch(script, /complete your \$47 purchase/);

  const success = makeContext({ chargeStatus: 'succeeded' });
  vm.runInNewContext(script, success.context);
  assert.equal(typeof success.elements.keysCtaBtn.listeners.click, 'function');
  await success.elements.keysCtaBtn.listeners.click();

  assert.deepEqual(success.chargeCalls, ['apartment_prep']);
  assert.equal(success.elements.sheetScrim.classList.contains('open'), true);
  assert.equal(success.elements.sheetScrim.classList.contains('payment-success'), true);
  assert.equal(success.elements.sheetScrim.title.textContent, 'Thank You');
  assert.match(success.elements.sheetScrim.sub.textContent, /download link is being sent to your email/);
  assert.equal(success.elements.pageRoot.classList.contains('is-payment-overlay-open'), true);
  await runTimer(success.timers[0]);
  assert.deepEqual(success.grants, [
    { step: 'apartment-list', details: { status: 'upsell-success', city: 'Miami' } },
  ]);
  assert.match(success.hrefs[0], /^\/real-estate-list\.html\?/);
  assert.match(success.hrefs[0], /leadId=lead_123/);
  assert.match(success.hrefs[0], /city=Miami/);

  const declined = makeContext({ chargeStatus: 'failed' });
  vm.runInNewContext(script, declined.context);
  await declined.elements.keysCtaBtn.listeners.click();

  assert.deepEqual(declined.chargeCalls, ['apartment_prep']);
  assert.equal(declined.elements.sheetScrim.classList.contains('payment-failed'), true);
  assert.equal(declined.elements.sheetScrim.title.textContent, 'We Couldn’t Complete Your Purchase Yet');
  assert.match(declined.elements.sheetScrim.sub.textContent, /\$20 purchase/);
  assert.deepEqual(declined.grants, [
    { step: 'apartment-list', details: { status: 'upsell-declined', city: 'Miami' } },
  ]);
  await runTimer(declined.timers[0]);
  assert.match(declined.hrefs[0], /^\/real-estate-list\.html\?/);
}

run()
  .then(() => console.log('second chance rental plan upsell page test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
