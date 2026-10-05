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
  const patchCalls = [];
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
      getPropertyVerification: async (propertyId) => ({
        propertyId,
        screeningStatus: 'unverified',
        verificationVersion: 'screening-v1',
        verificationExpiresAt: '2999-01-01T00:00:00.000Z',
      }),
      savePropertyVerification: async () => {},
      saveUserListingMatches: async () => {},
      patchEntitlements:
        patchEntitlements ||
        (async (leadId, patch) => {
          patchCalls.push({ leadId, patch });
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
    exports: {
      verify: () => null,
      seal: (payload) => `sealed_${Buffer.from(JSON.stringify(payload)).toString('base64url')}`,
    },
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

  return { handler: require('../netlify/functions/get-apartment-results').handler, savedResults, savedLeads, retrieveCalls, patchCalls };
}

function legacyPlace({
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
    place_id: id,
    name,
    formatted_address: address,
    address_components: [
      { long_name: city, short_name: city, types: ['locality', 'political'] },
      { long_name: state, short_name: state, types: ['administrative_area_level_1', 'political'] },
    ],
    formatted_phone_number: phone,
    website,
    url: mapsUrl || `https://maps.google.com/?cid=${encodeURIComponent(id)}`,
    rating,
    user_ratings_total: reviewCount,
    business_status: 'OPERATIONAL',
    types: ['apartment_building', 'point_of_interest', 'establishment'],
    photos: photoName
      ? [{
          photo_reference: `AWn5SU_legacy_ref_${id}`,
          html_attributions: ['<a href="https://maps.google.com/maps/contrib/123">Jane Doe</a>'],
        }]
      : [],
  };
}

function legacyResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function installLegacyGoogleMock(urls, places, options = {}) {
  let searchCalls = 0;
  let detailCalls = 0;
  const legacyPlaces = places.map((place) => legacyPlace(place));
  global.fetch = async (url, requestOptions) => {
    const value = String(url);
    urls.push(value);
    if (value.includes('/maps/api/place/textsearch/json')) {
      searchCalls++;
      const parsed = new URL(value);
      const query = parsed.searchParams.get('query') || '';
      assert.match(query, /apartment/i);
      assert.equal(requestOptions.method, 'GET');
      assert.equal(parsed.searchParams.get('key'), 'google_test_key');
      if (options.firstSearchEmpty && searchCalls === 1) return legacyResponse(200, { status: 'ZERO_RESULTS', results: [] });
      return legacyResponse(200, { status: 'OK', results: legacyPlaces.map(({ formatted_phone_number, website, url, ...place }) => place) });
    }
    if (value.includes('/maps/api/place/details/json')) {
      detailCalls++;
      const parsed = new URL(value);
      assert.equal(parsed.searchParams.get('key'), 'google_test_key');
      const placeId = parsed.searchParams.get('place_id');
      const place = legacyPlaces.find((candidate) => candidate.place_id === placeId);
      return legacyResponse(200, { status: place ? 'OK' : 'NOT_FOUND', result: place || {} });
    }
    throw new Error(`Unexpected fetch URL: ${url}`);
  };
  return {
    get searchCalls() { return searchCalls; },
    get detailCalls() { return detailCalls; },
  };
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
      {
        id: 'place_apartment_finder',
        name: 'Apartment Finder Concord',
        address: '200 Referral Way, Concord, NC',
        website: 'https://apartmentfinder.example.com/concord',
        mapsUrl: 'https://maps.google.com/?cid=apartmentfinder',
      },
      {
        id: 'place_apartment_hunters',
        name: 'Apartment Hunters Concord',
        address: '201 Referral Way, Concord, NC',
        website: 'https://apartmenthunters.example.com/concord',
        mapsUrl: 'https://maps.google.com/?cid=apartmenthunters',
      },
    ];
    const google = installLegacyGoogleMock(urls, concordPlaces);

    const { handler, savedResults } = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: '1',
        move_timeline: 'asap',
      },
      entitlements: {
        paid27: true, listingSubscriptionStatus: 'active',
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
    assert(!body.properties.some((property) => /finder|locator|hunter/i.test(property.name)));
    assert.equal(body.properties[0].phone, '(704) 555-0199');
    assert.equal(body.properties[0].website, 'https://example.com/concord-reserve');
    assert.equal(body.properties[0].propertyId, 'place_concord_1');
    assert.equal(body.properties[0].photoName, null);
    assert.equal(body.properties[0].photoReference, 'AWn5SU_legacy_ref_place_concord_1');
    assert.equal(body.properties[0].image, '/.netlify/functions/google-place-image?placeId=place_concord_1&photoRef=AWn5SU_legacy_ref_place_concord_1');
    assert.deepEqual(body.properties[0].authorAttributions, [{ displayName: 'Jane Doe', uri: 'https://maps.google.com/maps/contrib/123' }]);
    assert.equal(body.resultsVersion, 2);
    assert.deepEqual(body.nearbyAreas, ['Concord, NC']);
    assert.match(body.properties[0].availabilityNote, /availability/i);
    assert.equal(savedResults.length, 1);
    assert.equal(google.searchCalls, 10);
    assert.equal(google.detailCalls, 3);
    assert(!urls.some((url) => url.includes('places.googleapis.com/v1/places:searchText')));
    assert(urls.some((url) => url.includes('/maps/api/place/textsearch/json')));
    assert(urls.some((url) => url.includes('/maps/api/place/details/json')));

    const paidBaseCachedResult = {
      provider: 'google_places',
      resultsVersion: 2,
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
    };
    const paidBaseCheckout = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: '1',
      },
      entitlements: {
        paid10: true, listingSubscriptionStatus: 'active',
        paid27: false,
        purchasedCategories: [],
      },
      cached: paidBaseCachedResult,
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
    assert.equal(paidBaseCheckoutBody.properties[0].propertyId, 'paid10_cached_1');
    assert.match(paidBaseCheckoutBody.properties[0].matchId, /^match_/);

    const previewBaseCheckout = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: '1',
      },
      entitlements: {
        paid10: false,
        paid27: false,
        paid47: false,
        purchasedCategories: [],
      },
      cached: paidBaseCachedResult,
    });
    const previewBaseCheckoutRes = await previewBaseCheckout.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_paid10', preview: '1' },
    });
    const previewBaseCheckoutBody = JSON.parse(previewBaseCheckoutRes.body);
    assert.equal(previewBaseCheckoutRes.statusCode, 200);
    assert.equal(previewBaseCheckoutBody.preview, true);
    assert.equal(previewBaseCheckoutBody.properties[0].name, 'Apartment Match');
    assert.equal(previewBaseCheckoutBody.properties[1].name, 'Apartment Match');
    assert.equal(previewBaseCheckoutBody.properties[2].name, 'Apartment Match');
    assert.equal(previewBaseCheckoutBody.properties[0].address, '');
    assert.equal(previewBaseCheckoutBody.properties[0].phone, '');
    assert.equal(previewBaseCheckoutBody.properties[0].website, '');
    assert.match(previewBaseCheckoutBody.properties[0].image, /^\/\.netlify\/functions\/google-place-image\?pt=/);
    assert.doesNotMatch(previewBaseCheckoutBody.properties[0].image, /paid10_cached_1|photoName|photoRef|placeId/);
    assert.equal(previewBaseCheckoutBody.properties[0].bedroomLabel, '1 bedroom');
    assert.equal(previewBaseCheckoutBody.properties[0].screeningVerification.previewTag, undefined);
    assert.equal(previewBaseCheckoutBody.properties[0].screeningVerification.screeningStatus, 'unverified');
    assert.equal(previewBaseCheckoutBody.properties[0].screeningVerification.is_second_chance_verified, false);
    assert.equal(previewBaseCheckoutBody.properties[0].screeningVerification.previewOnlySecondChance, undefined);
    assert.equal(previewBaseCheckoutBody.properties[1].screeningVerification.screeningStatus, 'unverified');
    assert.equal(previewBaseCheckoutBody.properties[2].screeningVerification.screeningStatus, 'unverified');
    assert.equal(previewBaseCheckoutBody.properties.filter((property) => property.screeningVerification.screeningStatus === 'verified_second_chance').length, 0);
    assert.equal(previewBaseCheckoutBody.properties[0].matchId, paidBaseCheckoutBody.properties[0].matchId);

    // Results cached before photo references were saved must be regenerated.
    urls.length = 0;
    const staleVersionGoogle = installLegacyGoogleMock(urls, concordPlaces);
    const { resultsVersion: _staleVersion, ...staleCachedResult } = paidBaseCachedResult;
    const staleVersion = await loadHandler({
      lead: { preferred_city: 'Concord, NC', rent_budget: 1600, beds_needed: '1' },
      entitlements: { paid10: true, listingSubscriptionStatus: 'active', purchasedCategories: [] },
      cached: staleCachedResult,
    });
    const staleVersionBody = JSON.parse((await staleVersion.handler({
      httpMethod: 'GET',
      queryStringParameters: { leadId: 'lead_paid10' },
    })).body);
    assert.equal(staleVersionBody.ok, true);
    assert.equal(staleVersionGoogle.searchCalls, 10);
    assert.equal(staleVersionBody.properties[0].name, 'Concord Reserve Apartments');

    const prepUnlock = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: '1',
      },
      entitlements: {
        paid47: true, listingSubscriptionStatus: 'active',
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
    installLegacyGoogleMock(urls, concordPlaces);
    const prescreenRecovery = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: '1',
      },
      entitlements: {
        paid10: false,
        paid27: false,
        paid47: false,
        purchasedCategories: [],
      },
      upsellIntent: {
        id: 'pi_prescreen',
        status: 'succeeded',
        metadata: {},
        invoice: {
          subscription: {
            id: 'sub_prescreen',
            status: 'active',
            current_period_start: 1791020000,
            current_period_end: 1793612000,
            cancel_at_period_end: false,
            metadata: { leadId: 'lead_prescreen_recover', product: 'listing_membership' },
          },
        },
        customer: 'cus_test',
        payment_method: 'pm_test',
      },
    });
    const prescreenRecoveryRes = await prescreenRecovery.handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        leadId: 'lead_prescreen_recover',
        prescreenPaymentIntentId: 'pi_prescreen',
      }),
    });
    const prescreenRecoveryBody = JSON.parse(prescreenRecoveryRes.body);
    assert.equal(prescreenRecoveryRes.statusCode, 200);
    assert.equal(prescreenRecoveryBody.ok, true);
    assert.deepEqual(prescreenRecovery.retrieveCalls, ['pi_prescreen']);
    assert.deepEqual(prescreenRecovery.patchCalls[0], {
      leadId: 'lead_prescreen_recover',
      patch: {
        paid10: true,
        listingSubscriptionId: 'sub_prescreen',
        listingSubscriptionStatus: 'active',
        listingAccessStatus: 'active',
        listingSubscriptionStartedAt: '2026-10-03T09:33:20.000Z',
        listingSubscriptionCurrentPeriodEnd: '2026-11-02T09:33:20.000Z',
        listingSubscriptionCancelAtPeriodEnd: false,
        stripeCustomerId: 'cus_test',
        defaultPaymentMethodId: 'pm_test',
      },
    });

    urls.length = 0;
    installLegacyGoogleMock(urls, concordPlaces);
    const prepRecovery = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: '1',
      },
      entitlements: {
        paid10: true,
        paid27: false,
        paid47: false,
        listingSubscriptionStatus: 'active',
        listingAccessStatus: 'active',
        purchasedCategories: [],
      },
      upsellIntent: {
        id: 'pi_prep_upsell',
        status: 'succeeded',
        metadata: { leadId: 'lead_prep_recover', product: 'apartment_prep', category: 'apartment_prep' },
        customer: 'cus_test',
        payment_method: 'pm_test',
      },
    });
    const prepRecoveryRes = await prepRecovery.handler({
      httpMethod: 'GET',
      queryStringParameters: {
        leadId: 'lead_prep_recover',
        category: 'apartment_prep',
        upsellPaymentIntentId: 'pi_prep_upsell',
      },
    });
    const prepRecoveryBody = JSON.parse(prepRecoveryRes.body);
    assert.equal(prepRecoveryRes.statusCode, 200);
    assert.equal(prepRecoveryBody.ok, true);
    assert.deepEqual(prepRecovery.retrieveCalls, []);
    assert.deepEqual(prepRecovery.patchCalls, []);

    urls.length = 0;
    installLegacyGoogleMock(urls, concordPlaces);
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

    assert.equal(recoveryRes.statusCode, 403);
    assert.equal(recoveryBody.ok, false);
    assert.equal(recoveryBody.error.code, 'LISTING_ACCESS_DENIED');
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
    const newApi = installLegacyGoogleMock(urls, eightPlaces);
    const fresh = await loadHandler({
      lead: {
        preferred_city: 'Concord, NC',
        rent_budget: 1600,
        beds_needed: 'studio',
      },
      entitlements: {
        paid27: true, listingSubscriptionStatus: 'active',
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
    assert.equal(freshBody.properties[0].photoName, null);
    assert.match(freshBody.properties[0].image, /^\/\.netlify\/functions\/google-place-image\?placeId=place_new_1&photoRef=AWn5SU_legacy_ref_place_new_1$/);
    assert.equal(fresh.savedResults.length, 1);
    assert.equal(newApi.searchCalls, 10);

    urls.length = 0;
    const broad = installLegacyGoogleMock(urls, [
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
        paid27: true, listingSubscriptionStatus: 'active',
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
    assert.equal(broad.searchCalls, 10);

    urls.length = 0;
    installLegacyGoogleMock(urls, concordPlaces);
    const postFlow = await loadHandler({
      lead: null,
      entitlements: { paid27: true, listingSubscriptionStatus: 'active', purchasedCategories: ['luxury'] },
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
      if (value.includes('/maps/api/place/textsearch/json')) {
        const parsed = new URL(value);
        const query = parsed.searchParams.get('query') || '';
        variedQueries.push(query);
        const cityMatch = query.match(/in (.+)$/);
        const searched = cityMatch ? cityMatch[1] : 'Unknown, US';
        const cityName = searched.split(',')[0];
        const placeId = `place_${cityName.toLowerCase().replace(/\W+/g, '_')}`;
        return legacyResponse(200, { status: 'OK', results: [legacyPlace({
          id: placeId,
          name: `${cityName} Apartments`,
          address: `1 Main St, ${searched}`,
          rating: 4.3,
          reviewCount: 25,
          photoName: `places/${placeId}/photos/photo_1`,
        })] });
      }
      if (value.includes('/maps/api/place/details/json')) {
        const parsed = new URL(value);
        const placeId = parsed.searchParams.get('place_id');
        const cityName = placeId.replace(/^place_/, '').replace(/_/g, ' ');
        return legacyResponse(200, { status: 'OK', result: legacyPlace({
          id: placeId,
          name: `${cityName} Apartments`,
          address: `1 Main St, Concord, NC`,
          rating: 4.3,
          reviewCount: 25,
        }) });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };
    for (const city of ['Austin, TX', 'New York, NY', 'Mount Vernon, WA']) {
      const varied = await loadHandler({
        lead: { preferred_city: 'Concord, NC', rent_budget: 2100, beds_needed: '2' },
        entitlements: { paid27: true, listingSubscriptionStatus: 'active', purchasedCategories: ['modern'] },
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

    // The listing page's search dropdown explicitly changes city and price range.
    urls.length = 0;
    installLegacyGoogleMock(urls, concordPlaces);
    const override = await loadHandler({
      lead: { preferred_city: 'Concord, NC', rent_budget: 1600, beds_needed: '1' },
      entitlements: { paid10: true, listingSubscriptionStatus: 'active', purchasedCategories: [] },
    });
    const overrideRes = await override.handler({
      httpMethod: 'POST',
      queryStringParameters: null,
      body: JSON.stringify({
        leadId: 'lead_override',
        searchOverride: { city: 'Charlotte, North Carolina', rentBudgetMin: 1500, rentBudgetMax: 2000 },
      }),
    });
    const overrideBody = JSON.parse(overrideRes.body);
    assert.equal(overrideRes.statusCode, 200);
    assert.equal(overrideBody.criteria.city, 'Charlotte, NC');
    assert.equal(overrideBody.criteria.rentBudget, 2000);
    assert.equal(overrideBody.criteria.rentBudgetMin, 1500);
    const overrideQueries = urls.filter((url) => url.includes('/textsearch/')).map((url) => new URL(url).searchParams.get('query'));
    assert(overrideQueries.every((query) => query.includes('Charlotte, NC')));

    const badOverride = await loadHandler({
      lead: { preferred_city: 'Concord, NC', rent_budget: 1600, beds_needed: '1' },
      entitlements: { paid10: true, listingSubscriptionStatus: 'active', purchasedCategories: [] },
    });
    const badOverrideRes = await badOverride.handler({
      httpMethod: 'POST',
      queryStringParameters: null,
      body: JSON.stringify({ leadId: 'lead_override', searchOverride: { city: 'Nowhere', rentBudgetMax: 2000 } }),
    });
    assert.equal(badOverrideRes.statusCode, 400);
    assert.equal(JSON.parse(badOverrideRes.body).error.code, 'SEARCH_CRITERIA_INVALID');

    const postNoAnswers = await loadHandler({
      lead: null,
      entitlements: { paid27: true, listingSubscriptionStatus: 'active', purchasedCategories: ['luxury'] },
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
