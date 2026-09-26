const assert = require('assert');

async function loadHandler({ lead, entitlements, cached, upsellIntent, patchEntitlements }) {
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const signPath = require.resolve('../netlify/functions/_lib/sign');
  const stripePath = require.resolve('../netlify/functions/_lib/stripe');
  const fnPath = require.resolve('../netlify/functions/get-apartment-results');
  delete require.cache[fnPath];

  const savedResults = [];
  const savedLeads = [];
  const retrieveCalls = [];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getLead: async () => lead,
      saveLead: async (leadId, answers) => savedLeads.push({ leadId, answers }),
      getEntitlements: async () => entitlements,
      getApartmentResults: async () => cached || null,
      saveApartmentResults: async (leadId, category, results) => savedResults.push({ leadId, category, results }),
      patchEntitlements:
        patchEntitlements ||
        (async (leadId, patch) => {
          const { addPurchasedCategory, ...rest } = patch;
          const purchasedCategories = addPurchasedCategory
            ? Array.from(new Set([...(entitlements.purchasedCategories || []), addPurchasedCategory]))
            : entitlements.purchasedCategories || [];
          return { ...entitlements, ...rest, purchasedCategories, leadId };
        }),
    },
  };
  require.cache[signPath] = {
    id: signPath,
    filename: signPath,
    loaded: true,
    exports: { verify: () => null },
  };
  require.cache[stripePath] = {
    id: stripePath,
    filename: stripePath,
    loaded: true,
    exports: {
      getStripe: () => ({
        paymentIntents: {
          retrieve: async (id) => {
            retrieveCalls.push(id);
            return upsellIntent;
          },
        },
      }),
    },
  };

  return { handler: require('../netlify/functions/get-apartment-results').handler, savedResults, savedLeads, retrieveCalls };
}

function newPlace({
  id,
  name,
  address,
  phone = '(704) 555-0199',
  website = 'https://example.com/apartment',
  mapsUrl,
  rating = 4.7,
  reviewCount = 91,
  photoName,
  city = 'Concord',
  state = 'NC',
}) {
  return {
    id,
    displayName: { text: name },
    formattedAddress: address,
    addressComponents: [
      { longText: city, shortText: city, types: ['locality', 'political'] },
      { longText: state, shortText: state, types: ['administrative_area_level_1', 'political'] },
    ],
    nationalPhoneNumber: phone,
    websiteUri: website,
    googleMapsUri: mapsUrl || `https://maps.google.com/?cid=${encodeURIComponent(id)}`,
    rating,
    userRatingCount: reviewCount,
    businessStatus: 'OPERATIONAL',
    types: ['apartment_building', 'point_of_interest', 'establishment'],
    photos: photoName ? [{ name: photoName }] : [],
  };
}

function newSearchResponse(places) {
  return { ok: true, status: 200, json: async () => ({ places }) };
}

function installNewGoogleMock(urls, places, options = {}) {
  let searchCalls = 0;
  global.fetch = async (url, requestOptions) => {
    const value = String(url);
    urls.push(value);
    if (value.includes('places.googleapis.com/v1/places:searchText')) {
      searchCalls++;
      const body = JSON.parse(requestOptions && requestOptions.body ? requestOptions.body : '{}');
      const query = body.textQuery || '';
      assert.match(query, /apartment/i);
      assert.equal(requestOptions.method, 'POST');
      assert.equal(requestOptions.headers['X-Goog-Api-Key'], 'google_test_key');
      assert.match(requestOptions.headers['X-Goog-FieldMask'], /places\.id/);
      if (options.firstSearchEmpty && searchCalls === 1) return newSearchResponse([]);
      return newSearchResponse(places.map((place) => newPlace(place)));
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
  return { get searchCalls() { return searchCalls; } };
}

async function run() {
  const oldFetch = global.fetch;
  const oldGoogleKey = process.env.GOOGLE_PLACES_API_KEY;
  const oldOpenAIKey = process.env.OPENAI_API_KEY;
  const urls = [];
  process.env.GOOGLE_PLACES_API_KEY = 'google_test_key';
  delete process.env.OPENAI_API_KEY;

  try {
    const concordPlaces = [
      {
        id: 'place_concord_1',
        name: 'Concord Reserve Apartments',
        address: '1600 Concord Pkwy, Concord, NC',
        website: 'https://example.com/concord-reserve',
        mapsUrl: 'https://maps.google.com/?cid=concordreserve',
        photoName: 'places/place_concord_1/photos/photo_concord_1',
      },
    ];
    const google = installNewGoogleMock(urls, concordPlaces);

    const { handler, savedResults } = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: '1',
        move_timeline: 'asap',
      },
      entitlements: {
        paid27: true,
        purchasedCategories: ['luxury'],
      },
      cached: {
        provider: 'google_places',
        criteria: { category: 'luxury', city: 'Concord, NC', rentBudget: 1600, bedrooms: 1 },
        properties: [
          {
            propertyId: 'old_demo',
            name: 'Skyline House Uptown',
            phone: '(704) 555-0188',
            website: 'https://example.com/skyline-house',
          },
        ],
      },
    });

    const res = await handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_123', category: 'luxury' },
    });
    const body = JSON.parse(res.body);

    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.provider, 'google_places');
    assert.equal(body.criteria.city, 'Concord, NC');
    assert.equal(body.criteria.rentBudget, 1600);
    assert.equal(body.properties.length, 1);
    assert.equal(body.properties[0].name, 'Concord Reserve Apartments');
    assert.equal(body.properties[0].phone, '(704) 555-0199');
    assert.equal(body.properties[0].website, 'https://example.com/concord-reserve');
    assert.equal(body.properties[0].propertyId, 'place_concord_1');
    assert.equal(body.properties[0].photoName, 'places/place_concord_1/photos/photo_concord_1');
    assert.equal(body.properties[0].image, '/.netlify/functions/google-place-image?placeId=place_concord_1&photoName=places%2Fplace_concord_1%2Fphotos%2Fphoto_concord_1');
    assert.deepEqual(body.nearbyAreas, ['Concord, NC']);
    assert.match(body.properties[0].availabilityNote, /availability/i);
    assert.equal(savedResults.length, 1);
    assert.equal(google.searchCalls, 6);
    assert(urls.some((url) => url.includes('places.googleapis.com/v1/places:searchText')));
    assert(!urls.some((url) => url.includes('/maps/api/place/textsearch/json')));
    assert(!urls.some((url) => url.includes('/maps/api/place/details/json')));

    const paidBaseCheckout = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: '1',
      },
      entitlements: {
        paid10: true,
        paid27: false,
        purchasedCategories: [],
      },
      cached: {
        provider: 'google_places',
        category: 'questionnaire',
        criteria: { category: 'questionnaire', city: 'Concord, NC', searchArea: 'Concord, NC', rentBudget: 1600, bedrooms: 1 },
        properties: Array.from({ length: 8 }, (_, i) => ({
          propertyId: `paid10_cached_${i + 1}`,
          name: `Paid Checkout Apartments ${i + 1}`,
          phone: `(704) 777-02${String(i + 1).padStart(2, '0')}`,
          website: `https://paidcheckoutapartments${i + 1}.test`,
          photoName: `places/paid10_cached_${i + 1}/photos/cached_photo_${i + 1}`,
          image: `/.netlify/functions/google-place-image?placeId=paid10_cached_${i + 1}&photoName=places%2Fpaid10_cached_${i + 1}%2Fphotos%2Fcached_photo_${i + 1}`,
          source: 'Google Places',
        })),
      },
    });
    const paidBaseCheckoutRes = await paidBaseCheckout.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_paid10' },
    });
    const paidBaseCheckoutBody = JSON.parse(paidBaseCheckoutRes.body);
    assert.equal(paidBaseCheckoutRes.statusCode, 200);
    assert.equal(paidBaseCheckoutBody.ok, true);
    assert.equal(paidBaseCheckoutBody.category, 'questionnaire');
    assert.equal(paidBaseCheckoutBody.properties.length, 8);
    assert.equal(paidBaseCheckoutBody.properties[0].name, 'Paid Checkout Apartments 1');

    const prepUnlock = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: '1',
      },
      entitlements: {
        paid27: true,
        purchasedCategories: ['apartment_prep'],
      },
      cached: {
        provider: 'google_places',
        category: 'modern',
        criteria: { category: 'modern', city: 'Concord, NC', rentBudget: 1600, bedrooms: 1 },
        properties: [
          {
            propertyId: 'prep_demo',
            name: 'Prep Unlocked Apartments',
            phone: '(704) 555-0200',
            website: 'https://example.com/prep-unlocked',
          },
        ],
      },
    });
    const prepUnlockRes = await prepUnlock.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_prep', category: 'modern' },
    });
    const prepUnlockBody = JSON.parse(prepUnlockRes.body);
    assert.equal(prepUnlockRes.statusCode, 200);
    assert.equal(prepUnlockBody.ok, true);
    assert.equal(prepUnlockBody.category, 'questionnaire');

    urls.length = 0;
    installNewGoogleMock(urls, concordPlaces);
    const recovery = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: '1',
      },
      entitlements: {
        paid27: false,
        purchasedCategories: [],
      },
      upsellIntent: {
        id: 'pi_modern_upsell',
        status: 'succeeded',
        metadata: { leadId: 'lead_123', product: 'modern', category: 'modern' },
        customer: 'cus_test',
        payment_method: 'pm_test',
      },
    });
    const recoveryRes = await recovery.handler({
      httpMethod: 'GET',
      queryStringParameters: {
        leadId: 'lead_123',
        category: 'modern',
        upsellPaymentIntentId: 'pi_modern_upsell',
      },
    });
    const recoveryBody = JSON.parse(recoveryRes.body);

    assert.equal(recoveryRes.statusCode, 200);
    assert.equal(recoveryBody.ok, true);
    assert.equal(recoveryBody.criteria.category, 'questionnaire');
    assert.deepEqual(recovery.retrieveCalls, ['pi_modern_upsell']);

    urls.length = 0;
    const eightPlaces = Array.from({ length: 8 }, (_, i) => ({
      id: `place_new_${i + 1}`,
      name: `New Concord Apartments ${i + 1}`,
      address: `${33 + i} New API Blvd, Concord, NC`,
      phone: `(704) 555-03${String(i + 1).padStart(2, '0')}`,
      website: `https://new-concord-${i + 1}.test`,
      mapsUrl: `https://maps.google.com/?cid=newconcord${i + 1}`,
      rating: 4.8,
      reviewCount: 75 + i,
      photoName: `places/place_new_${i + 1}/photos/photo_${i + 1}`,
    }));
    const newApi = installNewGoogleMock(urls, eightPlaces);
    const fresh = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: 'studio',
      },
      entitlements: {
        paid27: true,
        purchasedCategories: ['luxury'],
      },
    });
    const freshRes = await fresh.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_123', category: 'luxury' },
    });
    const freshBody = JSON.parse(freshRes.body);

    assert.equal(freshRes.statusCode, 200);
    assert.equal(freshBody.ok, true);
    assert.equal(freshBody.properties.length, 8);
    assert.equal(freshBody.properties[0].name, 'New Concord Apartments 1');
    assert.equal(freshBody.properties[0].phone, '(704) 555-0301');
    assert.equal(freshBody.properties[0].website, 'https://new-concord-1.test');
    assert.equal(freshBody.properties[0].photoName, 'places/place_new_1/photos/photo_1');
    assert.match(freshBody.properties[0].image, /^\/\.netlify\/functions\/google-place-image\?placeId=place_new_1&photoName=/);
    assert.equal(fresh.savedResults.length, 1);
    assert.equal(newApi.searchCalls, 6);

    urls.length = 0;
    const broad = installNewGoogleMock(urls, [
      {
        id: 'place_broader_1',
        name: 'Broad Concord Apartments',
        address: '10 Union St, Concord, NC',
        phone: '(704) 555-0101',
        website: 'https://example.com/broad-concord',
        mapsUrl: 'https://maps.google.com/?cid=broadconcord',
      },
    ], { firstSearchEmpty: true });
    const broadFlow = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: 'studio',
      },
      entitlements: {
        paid27: true,
        purchasedCategories: ['luxury'],
      },
    });
    const broadRes = await broadFlow.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_123', category: 'luxury' },
    });
    const broadBody = JSON.parse(broadRes.body);
    assert.equal(broadRes.statusCode, 200);
    assert.equal(broadBody.properties.length, 1);
    assert.equal(broadBody.properties[0].name, 'Broad Concord Apartments');
    assert.equal(broad.searchCalls, 6);

    urls.length = 0;
    installNewGoogleMock(urls, concordPlaces);
    const postFlow = await loadHandler({
      lead: null,
      entitlements: { paid27: true, purchasedCategories: ['luxury'] },
    });
    const postAnswers = { preferred_city: 'Concord, NC', rent_budget: 1600, beds_needed: '1' };
    const postRes = await postFlow.handler({
      httpMethod: 'POST',
      queryStringParameters: null,
      body: JSON.stringify({ leadId: 'lead_post', category: 'luxury', answers: postAnswers }),
    });
    const postBody = JSON.parse(postRes.body);
    assert.equal(postRes.statusCode, 200);
    assert.equal(postBody.ok, true);
    assert.equal(postBody.properties.length, 1);
    assert.equal(postBody.properties[0].name, 'Concord Reserve Apartments');
    assert.equal(postFlow.savedLeads.length, 1);
    assert.equal(postFlow.savedLeads[0].leadId, 'lead_post');
    assert.equal(postFlow.savedLeads[0].answers.preferred_city, 'Concord, NC');

    urls.length = 0;
    const variedQueries = [];
    global.fetch = async (url, requestOptions) => {
      const value = String(url);
      urls.push(value);
      if (value.includes('places.googleapis.com/v1/places:searchText')) {
        const body = JSON.parse(requestOptions && requestOptions.body ? requestOptions.body : '{}');
        const query = body.textQuery || '';
        variedQueries.push(query);
        const cityMatch = query.match(/in (.+)$/);
        const searched = cityMatch ? cityMatch[1] : 'Unknown, US';
        const cityName = searched.split(',')[0];
        const placeId = `place_${cityName.toLowerCase().replace(/\W+/g, '_')}`;
        return newSearchResponse([newPlace({
          id: placeId,
          name: `${cityName} Apartments`,
          address: `1 Main St, ${searched}`,
          rating: 4.3,
          reviewCount: 25,
          photoName: `places/${placeId}/photos/photo_1`,
        })]);
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    for (const city of ['Austin, TX', 'New York, NY', 'Mount Vernon, WA']) {
      const varied = await loadHandler({
        lead: { preferred_city: 'Concord, NC', rent_budget: 2100, beds_needed: '2' },
        entitlements: { paid27: true, purchasedCategories: ['modern'] },
        cached: {
          provider: 'google_places',
          criteria: { category: 'modern', city: 'Concord, NC', searchArea: 'Concord, NC', rentBudget: 2100, bedrooms: 2 },
          properties: [{ propertyId: 'old_real', name: 'Old Real Apartments', website: 'https://real.example.org' }],
        },
      });
      const variedRes = await varied.handler({
        httpMethod: 'POST',
        queryStringParameters: null,
        body: JSON.stringify({
          leadId: 'lead_varied',
          category: 'modern',
          requestCriteria: { city, area: city, rentBudget: 2100, bedrooms: 2 },
        }),
      });
      const variedBody = JSON.parse(variedRes.body);
      assert.equal(variedRes.statusCode, 200, `expected ${city} override to be ignored and Supabase city to search successfully`);
      assert.equal(variedBody.criteria.city, 'Concord, NC');
      assert(variedBody.properties.length >= 1);
      assert.notEqual(variedBody.properties[0].name, 'Old Real Apartments');
      assert.match(variedBody.properties[0].image, /^\/\.netlify\/functions\/google-place-image\?placeId=/);
      assert.equal(varied.savedResults.length, 1);
    }
    assert(variedQueries.some((query) => query.includes('Concord, NC')));
    assert(!variedQueries.some((query) => query.includes('Austin, TX')));
    assert(!variedQueries.some((query) => query.includes('New York, NY')));
    assert(!variedQueries.some((query) => query.includes('Mount Vernon, WA')));

    const postNoAnswers = await loadHandler({
      lead: null,
      entitlements: { paid27: true, purchasedCategories: ['luxury'] },
    });
    const postNoAnswersRes = await postNoAnswers.handler({
      httpMethod: 'POST',
      queryStringParameters: null,
      body: JSON.stringify({ leadId: 'lead_post_2', category: 'luxury' }),
    });
    assert.equal(postNoAnswersRes.statusCode, 404);
  } finally {
    global.fetch = oldFetch;
    if (oldGoogleKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = oldGoogleKey;
    if (oldOpenAIKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAIKey;
  }
}

run()
  .then(() => console.log('get-apartment-results flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
