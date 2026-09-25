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

async function run() {
  const oldFetch = global.fetch;
  const oldGoogleKey = process.env.GOOGLE_PLACES_API_KEY;
  const oldOpenAIKey = process.env.OPENAI_API_KEY;
  const urls = [];
  let textSearchCalls = 0;
  process.env.GOOGLE_PLACES_API_KEY = 'google_test_key';
  delete process.env.OPENAI_API_KEY;

  global.fetch = async (url) => {
    urls.push(String(url));
    if (String(url).includes('/textsearch/')) {
      textSearchCalls++;
      const parsed = new URL(String(url));
      const query = parsed.searchParams.get('query');
      assert.match(query, /apartment/i);
      assert.match(query, /concord/i);
      // Regression guard: a `type` filter on Text Search is a hard
      // restriction, not a relevance hint, and real apartment communities
      // are almost never tagged `real_estate_agency` in Google's data.
      assert.equal(parsed.searchParams.get('type'), null);
      return {
        json: async () => ({
          results: [
            {
              place_id: 'place_concord_1',
              name: 'Concord Reserve Apartments',
              formatted_address: '1600 Concord Pkwy, Concord, NC',
              rating: 4.6,
              user_ratings_total: 88,
              business_status: 'OPERATIONAL',
            },
          ],
        }),
      };
    }
    if (String(url).includes('/details/')) {
      return {
        json: async () => ({
          result: {
            name: 'Concord Reserve Apartments',
            formatted_address: '1600 Concord Pkwy, Concord, NC',
            formatted_phone_number: '(704) 555-0199',
            website: 'https://example.com/concord-reserve',
            url: 'https://maps.google.com/?cid=concordreserve',
            rating: 4.7,
            user_ratings_total: 91,
            business_status: 'OPERATIONAL',
            address_components: [
              { long_name: 'Concord', types: ['locality', 'political'] },
              { short_name: 'NC', types: ['administrative_area_level_1', 'political'] },
            ],
          },
        }),
      };
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };

  try {
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
    assert.match(body.properties[0].image, /^\/\.netlify\/functions\/google-place-image\?kind=streetview/);
    assert.deepEqual(body.nearbyAreas, ['Concord, NC']);
    assert.match(body.properties[0].availabilityNote, /availability/i);
    assert.equal(savedResults.length, 1);
    assert.equal(textSearchCalls, 6);
    assert(urls.some((url) => url.includes('/textsearch/')));
    assert(urls.some((url) => url.includes('/details/')));

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
          image: `https://maps.googleapis.com/maps/api/streetview?location=paid${i + 1}`,
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
    textSearchCalls = 0;
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
    let deniedCalls = 0;
    let newPlacesCalls = 0;
    global.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/textsearch/')) {
        deniedCalls++;
        return {
          json: async () => ({
            status: 'REQUEST_DENIED',
            error_message: 'This API key is not authorized to use this service or API.',
            results: [],
          }),
        };
      }
      if (String(url).includes('places.googleapis.com/v1/places:searchText')) {
        newPlacesCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            places: Array.from({ length: 8 }, (_, i) => ({
              id: `place_new_api_${i + 1}`,
              displayName: { text: `New API Concord Apartments ${i + 1}` },
              formattedAddress: `${33 + i} New API Blvd, Concord, NC`,
              nationalPhoneNumber: `(704) 555-03${String(i + 1).padStart(2, '0')}`,
              websiteUri: `https://new-api-concord-${i + 1}.test`,
              googleMapsUri: `https://maps.google.com/?cid=newapiconcord${i + 1}`,
              rating: 4.8,
              userRatingCount: 75 + i,
              businessStatus: 'OPERATIONAL',
              types: ['apartment_building', 'point_of_interest', 'establishment'],
              addressComponents: [
                { longText: 'Concord', shortText: 'Concord', types: ['locality', 'political'] },
                { longText: 'North Carolina', shortText: 'NC', types: ['administrative_area_level_1', 'political'] },
              ],
              photos: [{ name: `places/place_new_api_${i + 1}/photos/photo_1` }],
            })),
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    const denied = await loadHandler({
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
    const deniedRes = await denied.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_123', category: 'luxury' },
    });
    const deniedBody = JSON.parse(deniedRes.body);

    assert.equal(deniedRes.statusCode, 200);
    assert.equal(deniedBody.ok, true);
    assert.equal(deniedBody.properties.length, 8);
    assert.equal(deniedBody.properties[0].name, 'New API Concord Apartments 1');
    assert.equal(deniedBody.properties[0].phone, '(704) 555-0301');
    assert.equal(deniedBody.properties[0].website, 'https://new-api-concord-1.test');
    assert.match(deniedBody.properties[0].image, /^\/\.netlify\/functions\/google-place-image\?kind=new-photo/);
    assert.equal(denied.savedResults.length, 1);
    assert.equal(deniedCalls, 1);
    assert.equal(newPlacesCalls, 1);

    urls.length = 0;
    let broadSearchCalls = 0;
    global.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/textsearch/')) {
        broadSearchCalls++;
        return {
          json: async () => ({
            status: broadSearchCalls === 1 ? 'ZERO_RESULTS' : 'OK',
            results:
              broadSearchCalls === 1
                ? []
                : [
                    {
                      place_id: 'place_broader_1',
                      name: 'Broad Concord Apartments',
                      formatted_address: '10 Union St, Concord, NC',
                      rating: 4.2,
                      user_ratings_total: 42,
                      business_status: 'OPERATIONAL',
                    },
                  ],
          }),
        };
      }
      if (String(url).includes('/details/')) {
        return {
          json: async () => ({
            result: {
              name: 'Broad Concord Apartments',
              formatted_address: '10 Union St, Concord, NC',
              formatted_phone_number: '(704) 555-0101',
              website: 'https://example.com/broad-concord',
              url: 'https://maps.google.com/?cid=broadconcord',
              rating: 4.2,
              user_ratings_total: 42,
              business_status: 'OPERATIONAL',
              address_components: [
                { long_name: 'Downtown Concord', types: ['neighborhood', 'political'] },
                { long_name: 'Concord', types: ['locality', 'political'] },
              ],
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    const broad = await loadHandler({
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
    const broadRes = await broad.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_123', category: 'luxury' },
    });
    const broadBody = JSON.parse(broadRes.body);

    assert.equal(broadRes.statusCode, 200);
    assert.equal(broadBody.properties.length, 1);
    assert.equal(broadBody.properties[0].name, 'Broad Concord Apartments');
    assert.equal(broadSearchCalls, 6);

    urls.length = 0;
    const emptyCache = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: 'studio',
      },
      entitlements: {
        paid27: true,
        purchasedCategories: ['luxury'],
      },
      cached: {
        provider: 'google_places',
        criteria: { category: 'luxury', city: 'Concord, NC', rentBudget: 1600, bedrooms: 0 },
        properties: [],
      },
    });
    const emptyCacheRes = await emptyCache.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_123', category: 'luxury' },
    });
    const emptyCacheBody = JSON.parse(emptyCacheRes.body);

    assert.equal(emptyCacheRes.statusCode, 200);
    assert.equal(emptyCacheBody.properties.length, 1);
    assert.equal(emptyCacheBody.properties[0].name, 'Broad Concord Apartments');
    assert(urls.some((url) => url.includes('/textsearch/')));

    // Regression: the results page calls this function with POST + a JSON
    // body. When no server-side lead exists, paid users should still get
    // results from the browser answers in that same request, and the
    // answers should be persisted for future calls.
    urls.length = 0;
    global.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/textsearch/')) {
        return {
          json: async () => ({
            status: 'OK',
            results: [
              {
                place_id: 'place_post_1',
                name: 'POST Fallback Apartments',
                formatted_address: '1 Postman Way, Concord, NC',
                rating: 4.4,
                user_ratings_total: 30,
                business_status: 'OPERATIONAL',
              },
            ],
          }),
        };
      }
      if (String(url).includes('/details/')) {
        return {
          json: async () => ({
            result: {
              name: 'POST Fallback Apartments',
              formatted_address: '1 Postman Way, Concord, NC',
              formatted_phone_number: '(704) 555-0177',
              website: 'https://example.com/post-fallback',
              url: 'https://maps.google.com/?cid=postfallback',
              rating: 4.4,
              user_ratings_total: 30,
              business_status: 'OPERATIONAL',
              address_components: [
                { long_name: 'Concord', types: ['locality', 'political'] },
              ],
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

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

    assert.equal(postRes.statusCode, 404);
    assert.equal(postBody.error.code, 'LEAD_NOT_FOUND');
    assert.equal(postFlow.savedLeads.length, 0);

    const fallbackCriteriaFlow = await loadHandler({
      lead: null,
      entitlements: { paid27: true, purchasedCategories: ['luxury'] },
    });
    const fallbackCriteriaRes = await fallbackCriteriaFlow.handler({
      httpMethod: 'POST',
      queryStringParameters: null,
      body: JSON.stringify({
        leadId: 'lead_fallback',
        category: 'luxury',
        fallbackCriteria: { city: 'High Point, NC', budgetMax: 2000, bedrooms: 1 },
      }),
    });
    const fallbackCriteriaBody = JSON.parse(fallbackCriteriaRes.body);

    assert.equal(fallbackCriteriaRes.statusCode, 404);
    assert.equal(fallbackCriteriaBody.error.code, 'LEAD_NOT_FOUND');

    urls.length = 0;
    const variedQueries = [];
    global.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/textsearch/')) {
        const parsed = new URL(String(url));
        const query = parsed.searchParams.get('query');
        variedQueries.push(query);
        const cityMatch = query.match(/in (.+)$/);
        const searched = cityMatch ? cityMatch[1] : 'Unknown, US';
        const cityName = searched.split(',')[0];
        return {
          json: async () => ({
            status: 'OK',
            results: [
              {
                place_id: `place_${cityName.toLowerCase().replace(/\W+/g, '_')}`,
                name: `${cityName} Apartments`,
                formatted_address: `1 Main St, ${searched}`,
                rating: 4.3,
                user_ratings_total: 25,
                business_status: 'OPERATIONAL',
              },
            ],
          }),
        };
      }
      if (String(url).includes('/details/')) {
        const placeId = new URL(String(url)).searchParams.get('place_id');
        const cityName = placeId.replace(/^place_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        return {
          json: async () => ({
            result: {
              name: `${cityName} Apartments`,
              formatted_address: `1 Main St, ${cityName}`,
              url: `https://maps.google.com/?cid=${encodeURIComponent(placeId)}`,
              rating: 4.3,
              user_ratings_total: 25,
              business_status: 'OPERATIONAL',
              address_components: [
                { long_name: `${cityName} Center`, types: ['neighborhood', 'political'] },
              ],
            },
          }),
        };
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
      assert.match(variedBody.properties[0].image, /^\/\.netlify\/functions\/google-place-image\?kind=streetview/);
      assert.equal(varied.savedResults.length, 1);
    }
    assert(variedQueries.some((query) => query.includes('Concord, NC')));
    assert(!variedQueries.some((query) => query.includes('Austin, TX')));
    assert(!variedQueries.some((query) => query.includes('New York, NY')));
    assert(!variedQueries.some((query) => query.includes('Mount Vernon, WA')));

    urls.length = 0;
    variedQueries.length = 0;
    global.fetch = async (url) => {
      urls.push(String(url));
      if (String(url).includes('/textsearch/')) {
        const parsed = new URL(String(url));
        const query = parsed.searchParams.get('query');
        variedQueries.push(query);
        const cityMatch = query.match(/in (.+)$/);
        const searched = cityMatch ? cityMatch[1] : 'Unknown, US';
        const cityName = searched.split(',')[0];
        return {
          json: async () => ({
            status: 'OK',
            results: [
              {
                place_id: `place_${cityName.toLowerCase().replace(/\W+/g, '_')}`,
                name: `${cityName} Apartments`,
                formatted_address: `1 Main St, ${searched}`,
                rating: 4.3,
                user_ratings_total: 25,
                business_status: 'OPERATIONAL',
              },
            ],
          }),
        };
      }
      if (String(url).includes('/details/')) {
        const placeId = new URL(String(url)).searchParams.get('place_id');
        const cityName = placeId.replace(/^place_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        return {
          json: async () => ({
            result: {
              name: `${cityName} Apartments`,
              formatted_address: `1 Main St, ${cityName}`,
              url: `https://maps.google.com/?cid=${encodeURIComponent(placeId)}`,
              rating: 4.3,
              user_ratings_total: 25,
              business_status: 'OPERATIONAL',
              address_components: [
                { long_name: `${cityName} Center`, types: ['neighborhood', 'political'] },
              ],
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    const fullState = await loadHandler({
      lead: { preferred_city: 'Concord, NC', rent_budget: 2100, beds_needed: '2' },
      entitlements: { paid27: true, purchasedCategories: ['modern'] },
    });
    const fullStateRes = await fullState.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_full_state', category: 'modern', city: 'Austin, Texas' },
    });
    const fullStateBody = JSON.parse(fullStateRes.body);
    assert.equal(fullStateRes.statusCode, 200);
    assert.equal(fullStateBody.criteria.city, 'Concord, NC');
    assert(variedQueries.some((query) => query.includes('Concord, NC')));
    assert(!variedQueries.some((query) => query.includes('Austin, TX')));

    urls.length = 0;
    variedQueries.length = 0;
    const ambiguousLocation = await loadHandler({
      lead: { preferred_city: 'Springfield', rent_budget: 1500, beds_needed: '1' },
      entitlements: { paid27: true, purchasedCategories: ['luxury'] },
    });
    const ambiguousLocationRes = await ambiguousLocation.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_ambiguous', category: 'luxury' },
    });
    const ambiguousLocationBody = JSON.parse(ambiguousLocationRes.body);
    assert.equal(ambiguousLocationRes.statusCode, 200);
    assert.equal(ambiguousLocationBody.criteria.city, 'Springfield');
    assert.match(ambiguousLocationBody.criteria.locationWarning, /not normalized/i);
    assert(variedQueries.some((query) => query.includes('Springfield')));

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
