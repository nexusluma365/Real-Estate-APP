const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'app/src/pages/RealEstateList/script-0.js'), 'utf8');

function createElement(id) {
  return {
    id,
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    innerHTML: '',
    textContent: '',
    addEventListener() {},
    setAttribute() {},
    scrollIntoView() {},
  };
}

async function run() {
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, createElement(id));
    return elements.get(id);
  };

  const answers = {
    lead_id: 'lead_miami',
    preferred_city: 'miami',
    rent_budget: 2000,
    beds_needed: '2',
  };

  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URLSearchParams,
    URL,
    AbortController,
    encodeURIComponent,
    window: {
      location: { search: '', href: 'https://werentreadygo.com/real-estate-list/', replace() {} },
      history: { state: {}, replaceState() {}, pushState() {} },
      addEventListener() {},
      matchMedia: () => ({ matches: true }),
      rrnFetchEntitlements: async () => ({ paid10: true, paid27: false, purchasedCategories: [] }),
      rrnHasRecentFlowAccess: () => true,
    },
    document: {
      body: { style: {} },
      getElementById,
      querySelectorAll: () => [],
      addEventListener() {},
    },
    sessionStorage: {
      getItem: (key) => (key === 'rrn_answers_v1' ? JSON.stringify(answers) : null),
    },
    localStorage: {
      getItem: () => null,
    },
    navigator: {},
    fetch: async (url) => {
      assert.equal(url, '/.netlify/functions/get-apartment-results');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          provider: 'google_places',
          googleStatus: 'REQUEST_DENIED',
          message: 'Verified apartment results are temporarily unavailable. You can still browse the listing page and continue your rental plan.',
          criteria: {
            category: 'questionnaire',
            city: 'miami',
            searchArea: 'miami',
            rentBudget: 2000,
            bedrooms: 2,
          },
          nearbyAreas: [],
          properties: [],
        }),
      };
    },
  };
  context.window.window = context.window;
  context.rrnFetchEntitlements = context.window.rrnFetchEntitlements;
  context.rrnHasRecentFlowAccess = context.window.rrnHasRecentFlowAccess;

  vm.runInNewContext(script, context);
  assert.equal(await context.requireListingAccess(), true);
  context.applyAnswerCriteria();
  await context.loadVerifiedApartmentResults();
  context.renderAll();

  assert.equal(getElementById('emptySection').style.display, 'none');
  assert.equal(getElementById('listSection').style.display, 'block');
  assert.match(getElementById('listingList').innerHTML, /Apartments for rent in miami/);
  assert.match(getElementById('listingList').innerHTML, /2 bedrooms apartments in miami/);
  assert.doesNotMatch(getElementById('heroSub').textContent, /temporarily unavailable/i);
}

run()
  .then(() => console.log('real estate list provider fallback test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
