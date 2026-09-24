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
  const googleProperties = Array.from({ length: 8 }, (_, i) => ({
    propertyId: `google_miami_${i + 1}`,
    name: `Miami Google Apartments ${i + 1}`,
    address: `${100 + i} Biscayne Blvd, Miami, FL`,
    area: 'Miami, FL',
    phone: `(305) 777-10${String(i + 1).padStart(2, '0')}`,
    website: `https://miami-google-apartments-${i + 1}.test`,
    directions: `https://maps.google.com/?cid=miamigoogle${i + 1}`,
    rating: 4.4,
    reviewCount: 50 + i,
    image: `/.netlify/functions/google-place-image?kind=photo&ref=photo_${i + 1}`,
    source: 'Google Places',
    matchScore: 88 - i,
    matchReasons: ['Searched for apartments in miami', 'Contact details found through Google Places'],
    summary: 'A real Google Places apartment community match.',
  }));

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
          category: 'questionnaire',
          criteria: {
            category: 'questionnaire',
            city: 'miami',
            searchArea: 'miami',
            rentBudget: 2000,
            bedrooms: 2,
          },
          nearbyAreas: ['Miami, FL'],
          properties: googleProperties,
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

  const html = getElementById('listingList').innerHTML;
  assert.equal(getElementById('emptySection').style.display, 'none');
  assert.equal(getElementById('listSection').style.display, 'block');
  assert.equal(getElementById('resultCount').textContent, '8 matches');
  assert.equal((html.match(/<article class="listing/g) || []).length, 8);
  assert.equal((html.match(/<img src="\/\.netlify\/functions\/google-place-image\?kind=photo/g) || []).length, 8);
  assert.doesNotMatch(html, /photo-placeholder/);
  assert.doesNotMatch(html, /Apartment search/);
}

run()
  .then(() => console.log('real estate list google results test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
