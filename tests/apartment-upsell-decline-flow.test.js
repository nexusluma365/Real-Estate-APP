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
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
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

async function runDeclineCase({ scriptPath, category, city }) {
  const script = fs.readFileSync(scriptPath, 'utf8');
  const elements = {
    checkoutBtn: createElement('checkoutBtn'),
    sheetScrim: createElement('sheetScrim'),
    sheetCancel: createElement('sheetCancel'),
    sheetConfirm: createElement('sheetConfirm'),
  };
  elements.sheetScrim.sub = createElement('sheetSub');
  elements.sheetScrim.title = createElement('sheetTitle');

  const grants = [];
  let emailCalls = 0;
  const hrefs = [];
  const context = {
    console,
    URLSearchParams,
    document: {
      querySelectorAll: () => [],
      getElementById: (id) => elements[id] || null,
    },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    sessionStorage: {
      getItem: (key) =>
        key === 'rrn_answers_v1'
          ? JSON.stringify({ lead_id: 'lead_123', preferred_city: city })
          : null,
    },
    localStorage: {
      getItem: () => null,
    },
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    rrnLeadId: () => 'lead_123',
    rrnFetchEntitlements: async () => ({ paid10: true, paid27: false, purchasedCategory: null }),
    rrnGetStripePublishableKey: async () => '',
    rrnChargeUpsell: async () => 'failed',
    rrnEmailAsset: async () => {
      emailCalls += 1;
      return true;
    },
    rrnGrantFlowAccess: (step, details) => grants.push({ step, details }),
    window: {
      get location() {
        return this._location;
      },
      _location: {
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

  vm.runInNewContext(script, context);
  assert.equal(typeof elements.checkoutBtn.listeners.click, 'function');
  await elements.checkoutBtn.listeners.click();

  assert.equal(emailCalls, 0);
  assert.deepEqual(grants, [
    {
      step: 'apartment-list',
      details: { status: 'upsell-declined', category, city },
    },
  ]);
  assert.match(elements.sheetConfirm.dataset.target, /^\/real-estate-list\.html\?/);
  assert.match(hrefs[hrefs.length - 1], /^\/real-estate-list\.html\?/);
  assert.match(hrefs[hrefs.length - 1], new RegExp(`category=${category}`));
}

async function run() {
  await runDeclineCase({
    scriptPath: 'app/src/pages/ModernApartmentsPremium/script-0.js',
    category: 'modern',
    city: 'Charlotte, NC',
  });
  await runDeclineCase({
    scriptPath: 'app/src/pages/LuxuryApartmentsPremium/script-0.js',
    category: 'luxury',
    city: 'Atlanta, GA',
  });

  const listingScript = fs.readFileSync('app/src/pages/RealEstateList/script-0.js', 'utf8');
  assert.match(listingScript, /statuses:\s*\["upsell-success",\s*"upsell-declined"\]/);
}

run()
  .then(() => console.log('apartment upsell decline flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
