// GET  /.netlify/functions/get-apartment-results?leadId=...
// POST /.netlify/functions/get-apartment-results   body: { leadId, answers? }
//
// Produces personalized apartment results from the user's questionnaire.
// Factual property data comes from Google Places when GOOGLE_PLACES_API_KEY
// is configured. OpenAI is optional and may only rank/summarize verified
// properties; it never creates property facts.
//
// Both GET (query string, plus a signed `token` for emailed links) and POST
// (JSON body) are supported. The server-side lead record is the source of
// truth whenever it exists, with same-request questionnaire criteria as a
// recovery path for paid users whose lead record has not synced yet.
const { getLead, saveLead, getEntitlements, getApartmentResults, saveApartmentResults } = require('./_lib/store');
const { verify } = require('./_lib/sign');
const { getStripe } = require('./_lib/stripe');

const RESULTS_CATEGORY = 'questionnaire';
const LEGACY_CATEGORIES = new Set(['modern', 'luxury', 'apartment_prep']);
const MAX_RESULTS = 8;
const GOOGLE_CANDIDATE_LIMIT = 24;
const VALID_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);
const GOOGLE_FETCH_TIMEOUT_MS = Number(process.env.GOOGLE_FETCH_TIMEOUT_MS || 7000);
const OPENAI_RANK_TIMEOUT_MS = Number(process.env.OPENAI_RANK_TIMEOUT_MS || 7000);

class GooglePlacesError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GooglePlacesError';
    this.status = status;
  }
}

function listingLog(message, detail) {
  console.log('get-apartment-results', message, sanitizeLogDetail(detail));
}

function listingWarn(message, detail) {
  console.warn('get-apartment-results', message, sanitizeLogDetail(detail));
}

function sanitizeLogDetail(detail) {
  if (!detail || typeof detail !== 'object') return detail || {};
  const safe = { ...detail };
  delete safe.token;
  delete safe.apiKey;
  return safe;
}

function errorResponse(statusCode, code, message, extra) {
  return json(statusCode, {
    ok: false,
    success: false,
    error: { code, message },
    ...(extra || {}),
  });
}

function parseRequest(event) {
  const q = event.queryStringParameters || {};
  let body = {};
  if (event.httpMethod === 'POST' && event.body) {
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      body = JSON.parse(raw) || {};
    } catch (_err) {
      body = {};
    }
  }

  let leadId = body.leadId || q.leadId;
  let category = normalizeResultsCategory(body.category || q.category);
  const upsellPaymentIntentId = body.upsellPaymentIntentId || q.upsellPaymentIntentId || '';
  const answers = body.answers && typeof body.answers === 'object' ? body.answers : null;
  const fallbackCriteria = body.fallbackCriteria && typeof body.fallbackCriteria === 'object' ? body.fallbackCriteria : null;
  const bodyRequestCriteria = body.requestCriteria && typeof body.requestCriteria === 'object' ? body.requestCriteria : null;
  const queryRequestCriteria =
    q.city || q.location || q.area || q.searchArea || q.rentBudget || q.budget || q.bedrooms || q.beds
      ? {
          city: q.city || q.location || '',
          area: q.area || q.searchArea || '',
          rentBudget: q.rentBudget || q.budget || '',
          bedrooms: q.bedrooms || q.beds || '',
        }
      : null;
  const requestCriteria = bodyRequestCriteria || queryRequestCriteria;
  const token = body.token || q.token;

  if (token) {
    const data = verify(token);
    if (!data || data.product !== 'apartment-results') {
      return { error: json(403, { ok: false, error: 'This link has expired. Request a new one from the site.' }) };
    }
    leadId = data.leadId;
    category = normalizeResultsCategory(data.category);
  }

  return { leadId, category, upsellPaymentIntentId, answers, fallbackCriteria, requestCriteria };
}

function normalizeResultsCategory(value) {
  const category = String(value || '').toLowerCase();
  return LEGACY_CATEGORIES.has(category) ? RESULTS_CATEGORY : RESULTS_CATEGORY;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const parsed = parseRequest(event);
  if (parsed.error) return parsed.error;
  const { leadId, category, upsellPaymentIntentId, answers, fallbackCriteria, requestCriteria } = parsed;

  if (!leadId) {
    return errorResponse(400, 'LEAD_ID_MISSING', 'We could not find your listing session. Please return to your results and try again.');
  }

  try {
    listingLog('request', { leadId, method: event.httpMethod, category });
    let entitlements = await getEntitlements(leadId);
    const hasListingAccess = (e) => !!(e && (e.paid10 || e.paid27));
    if (!hasListingAccess(entitlements) && upsellPaymentIntentId) {
      entitlements = await recoverApartmentEntitlement(leadId, category, upsellPaymentIntentId, entitlements);
    }
    if (!hasListingAccess(entitlements)) {
      return errorResponse(403, 'LISTING_ACCESS_DENIED', 'This apartment list is not unlocked yet.');
    }

    let lead;
    try {
      lead = await getLead(leadId);
    } catch (err) {
      listingWarn('supabase lead lookup failed', { leadId, message: err.message || String(err) });
      return errorResponse(502, 'SUPABASE_ERROR', 'We could not load your saved questionnaire right now. Please refresh in a moment.');
    }
    if (!lead && answers && clientAnswersMatchLead(answers, leadId)) {
      lead = { ...answers, lead_id: leadId };
      try {
        await saveLead(leadId, lead);
      } catch (err) {
        listingWarn('lead resync save failed', { leadId, message: err.message || String(err) });
      }
    }
    if (!lead && fallbackCriteria) {
      lead = leadFromFallbackCriteria(fallbackCriteria, leadId);
      if (lead) {
        try {
          await saveLead(leadId, lead);
        } catch (err) {
          listingWarn('fallback lead save failed', { leadId, message: err.message || String(err) });
        }
      }
    }
    if (!lead) return errorResponse(404, 'LEAD_NOT_FOUND', 'No saved questionnaire was found for this listing session.');

    const criteria = buildCriteria(lead, category, requestCriteria || fallbackCriteria);
    if (!criteria.city) {
      return errorResponse(400, 'SEARCH_CRITERIA_MISSING', 'Please enter a U.S. city and state, like Austin, TX.');
    }
    listingLog('criteria', { leadId, city: criteria.city, searchArea: criteria.searchArea, rentBudget: criteria.rentBudget, bedrooms: criteria.bedrooms });
    const cached = await getApartmentResults(leadId, category);
    if (isUsableCachedResult(cached, criteria)) return json(200, { ok: true, ...cached });

    if (!googlePlacesApiKey()) {
      listingWarn('google places api key missing', { leadId, city: criteria.city });
      return errorResponse(503, 'GOOGLE_PLACES_CONFIG_ERROR', 'Apartment listings are temporarily unavailable while Google Places is being configured.');
    }

    let rawProperties;
    try {
      rawProperties = await fetchGooglePlaces(criteria);
    } catch (err) {
      if (err instanceof GooglePlacesError) {
        if (isAnyUsableCachedResult(cached, criteria)) {
          listingWarn('google places failed; returning cached google listings', { leadId, status: err.status, count: cached.properties.length });
          return json(200, {
            ok: true,
            ...cached,
            message: cached.message || 'Showing your latest verified Google apartment matches while fresh results reload.',
            providerWarning: err.status,
          });
        }
        const code = isGoogleSetupStatus(err.status) ? 'GOOGLE_PLACES_CONFIG_ERROR' : 'GOOGLE_PLACES_ERROR';
        listingWarn('google places failed', { leadId, status: err.status, message: err.message });
        return errorResponse(502, code, 'Verified apartment listings are temporarily unavailable. Please refresh in a moment.', {
          provider: 'google_places',
          googleStatus: err.status,
          criteria,
        });
      }
      throw err;
    }
    if (!rawProperties.length) {
      const empty = {
        provider: 'google_places',
        criteria,
        nearbyAreas: [],
        message: "We couldn't find apartment communities for this search yet. Try a broader nearby city or refresh in a moment.",
        properties: [],
      };
      return json(200, { ok: true, leadId, category, generatedAt: new Date().toISOString(), ...empty });
    }

    const properties = (await rankWithOpenAI(rawProperties, criteria)).slice(0, MAX_RESULTS);
    const result = { provider: 'google_places', message: null, criteria, nearbyAreas: nearbyAreasFromProperties(properties, criteria), properties };
    await saveApartmentResults(leadId, category, result);
    return json(200, { ok: true, leadId, category, generatedAt: new Date().toISOString(), ...result });
  } catch (err) {
    console.error('get-apartment-results error', err);
    return json(500, { ok: false, error: 'Could not load apartment results right now.' });
  }
};

function clientAnswersMatchLead(answers, leadId) {
  const answerLeadId = String(answers.lead_id || answers.leadId || '').trim();
  return !answerLeadId || answerLeadId === leadId;
}

function leadFromFallbackCriteria(criteria, leadId) {
  const preferredCity = clean(criteria.city || criteria.area || criteria.searchArea);
  if (!preferredCity) return null;
  return {
    lead_id: leadId,
    preferred_city: preferredCity,
    rent_budget: Number(criteria.rentBudget || criteria.budgetMax || criteria.budget) || '',
    beds_needed:
      criteria.bedrooms === 0 || criteria.bedrooms
        ? String(criteria.bedrooms)
        : clean(criteria.bedroomsLabel || ''),
    move_timeline: clean(criteria.moveTimeline),
    move_reason: clean(criteria.moveReason),
    recovered_from: 'apartment-list-fallback',
  };
}

async function recoverApartmentEntitlement(leadId, category, paymentIntentId, current) {
  let pi;
  try {
    pi = await getStripe().paymentIntents.retrieve(paymentIntentId);
  } catch (err) {
    console.warn('apartment entitlement recovery lookup failed', err.code || err.message);
    return current;
  }

  const metadata = pi.metadata || {};
  if (pi.status !== 'succeeded' || metadata.leadId !== leadId || !LEGACY_CATEGORIES.has(String(metadata.product || metadata.category || '').toLowerCase())) {
    return current;
  }

  const patch = { paid27: true, addPurchasedCategory: String(metadata.product || metadata.category || 'apartment_prep').toLowerCase() };
  if (pi.customer) patch.stripeCustomerId = pi.customer;
  if (pi.payment_method) patch.defaultPaymentMethodId = pi.payment_method;

  try {
    const { patchEntitlements } = require('./_lib/store');
    return await patchEntitlements(leadId, patch);
  } catch (err) {
    console.error('apartment entitlement recovery save failed', err);
    return { ...current, ...patch, leadId };
  }
}

async function fetchGooglePlaces(criteria) {
  const key = googlePlacesApiKey();
  if (!key) throw new GooglePlacesError('Google Places API key is not configured.', 'MISSING_API_KEY');

  try {
    const newApiResults = await fetchGooglePlacesNew(criteria, key);
    if (newApiResults.length >= MAX_RESULTS) return newApiResults.slice(0, MAX_RESULTS);
    try {
      const legacyResults = await fetchGooglePlacesLegacy(criteria, key);
      return combineGoogleResults(newApiResults, legacyResults).slice(0, MAX_RESULTS);
    } catch (legacyError) {
      if (newApiResults.length) return newApiResults.slice(0, MAX_RESULTS);
      throw legacyError;
    }
  } catch (newApiError) {
    try {
      const legacyResults = await fetchGooglePlacesLegacy(criteria, key);
      return legacyResults.slice(0, MAX_RESULTS);
    } catch (_legacyError) {
      throw newApiError;
    }
  }
}

function googlePlacesApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
}

async function fetchGooglePlacesLegacy(criteria, key) {
  const resultsByPlaceId = new Map();
  for (const query of googlePlaceQueries(criteria)) {
    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', query);
    // NOTE: intentionally no `type` param. Google's `type` filter is a hard
    // restriction, not a relevance hint, and apartment communities are almost
    // never tagged `real_estate_agency` (that type is for leasing/realtor
    // offices). Setting it here silently filtered out nearly every real
    // apartment complex. The query text itself ("apartments in <city>",
    // "apartment communities in <city>") already steers Text Search toward
    // the right category.
    url.searchParams.set('key', key);

    const resp = await fetchWithTimeout(url, undefined, GOOGLE_FETCH_TIMEOUT_MS);
    const data = await resp.json().catch(() => ({}));
    assertGooglePlacesResponse(data);
    const results = Array.isArray(data.results) ? data.results : [];
    results.forEach((place) => {
      if (place.place_id && !resultsByPlaceId.has(place.place_id)) {
        resultsByPlaceId.set(place.place_id, place);
      }
    });
    if (resultsByPlaceId.size >= GOOGLE_CANDIDATE_LIMIT) break;
  }

  const results = Array.from(resultsByPlaceId.values())
    .slice(0, GOOGLE_CANDIDATE_LIMIT);
  const details = await Promise.all(results.map((p) => fetchPlaceDetails(p.place_id, key)));

  return realApartmentResults(results.map((p, index) => normalizePlace(p, details[index], criteria, key))).slice(0, MAX_RESULTS);
}

async function fetchGooglePlacesNew(criteria, key) {
  const resultsByPlaceId = new Map();
  for (const query of googlePlaceQueries(criteria)) {
    const resp = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': [
          'places.id',
          'places.displayName',
          'places.formattedAddress',
          'places.addressComponents',
          'places.nationalPhoneNumber',
          'places.internationalPhoneNumber',
          'places.websiteUri',
          'places.googleMapsUri',
          'places.rating',
          'places.userRatingCount',
          'places.photos',
          'places.types',
          'places.businessStatus',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: query,
        pageSize: Math.min(GOOGLE_CANDIDATE_LIMIT, 20),
        regionCode: 'US',
      }),
    }, GOOGLE_FETCH_TIMEOUT_MS);
    const data = await resp.json().catch(() => ({}));
    assertGooglePlacesNewResponse(data, resp.status, resp.ok);
    const places = Array.isArray(data.places) ? data.places : [];
    places.forEach((place) => {
      if (place.id && !resultsByPlaceId.has(place.id)) {
        resultsByPlaceId.set(place.id, place);
      }
    });
    if (resultsByPlaceId.size >= GOOGLE_CANDIDATE_LIMIT) break;
  }

  return realApartmentResults(Array.from(resultsByPlaceId.values())
    .slice(0, GOOGLE_CANDIDATE_LIMIT)
    .map((place) => normalizeNewPlace(place, criteria, key))
    .filter((place) => place.propertyId && place.name));
}

function googlePlaceQueries(criteria) {
  const bedroomText = criteria.bedroomsLabel ? `${criteria.bedroomsLabel} ` : '';
  const primary = searchLocationForArea(criteria.searchArea, criteria.city);
  const locations = [primary];
  if (criteria.searchArea && criteria.searchArea !== criteria.city) locations.push(criteria.city);

  return unique(locations.filter(Boolean).map(usSearchLocation)).flatMap((location) => [
    `${bedroomText}apartments for rent in ${location}`,
    `apartment communities in ${location}`,
    `rental apartments in ${location}`,
    `apartment complexes in ${location}`,
    `professionally managed apartments in ${location}`,
    `apartment rentals near ${location}`,
  ]);
}

function realApartmentResults(properties) {
  const seen = new Set();
  const apartmentTypePattern = /apartment|real_estate_agency|point_of_interest|establishment|premise/i;
  const apartmentTextPattern = /\b(apartments?|apartment homes|apartment community|residences|villas|flats|lofts|townhomes|terrace|landing|station|commons|reserve|retreat|pointe|place|park|village)\b/i;
  const bannedTypePattern = /lodging|hotel|motel|campground|rv_park|storage|school|university|restaurant|bar|shopping_mall|hospital/i;

  return properties.filter((property) => {
    if (!property || !property.propertyId || !property.name) return false;
    if (seen.has(property.propertyId)) return false;
    seen.add(property.propertyId);
    const types = Array.isArray(property.types) ? property.types.join(' ') : '';
    if (bannedTypePattern.test(types)) return false;
    const text = `${property.name} ${property.address || ''}`;
    return apartmentTextPattern.test(text) || apartmentTypePattern.test(types);
  });
}

function combineGoogleResults(...groups) {
  const byId = new Map();
  groups.flat().forEach((property) => {
    if (property && property.propertyId && !byId.has(property.propertyId)) {
      byId.set(property.propertyId, property);
    }
  });
  return realApartmentResults(Array.from(byId.values()));
}

function usSearchLocation(location) {
  const value = clean(location);
  if (!value) return '';
  return normalizeCityState(value) ? value : `${value}, United States`;
}

function searchLocationForArea(searchArea, city) {
  const area = clean(searchArea);
  const baseCity = clean(city);
  if (!area || area === baseCity) return baseCity;
  if (normalizeCityState(area)) return area;
  if (!baseCity) return area;
  if (area.toLowerCase().includes(baseCity.toLowerCase())) return area;
  return `${area}, ${baseCity}`;
}

function unique(values) {
  return Array.from(new Set(values));
}

function assertGooglePlacesResponse(data) {
  const status = data && data.status;
  if (!status || status === 'OK' || status === 'ZERO_RESULTS') return;

  const googleMessage = data.error_message ? ` ${data.error_message}` : '';
  const message = isGoogleSetupStatus(status)
    ? `Google Places is not returning apartment results because of a Google Maps API setup issue: ${status}.${googleMessage}`
    : `Google Places returned ${status}.${googleMessage}`;
  throw new GooglePlacesError(message.trim(), status);
}

function assertGooglePlacesNewResponse(data, statusCode, ok) {
  if (ok && !data.error) return;
  const status = (data.error && (data.error.status || data.error.code)) || `HTTP_${statusCode || 500}`;
  const googleMessage = data.error && data.error.message ? ` ${data.error.message}` : '';
  const message = isGoogleSetupStatus(status)
    ? `Google Places API (New) is not returning apartment results because of a Google Maps API setup issue: ${status}.${googleMessage}`
    : `Google Places API (New) returned ${status}.${googleMessage}`;
  throw new GooglePlacesError(message.trim(), status);
}

function isGoogleSetupStatus(status) {
  return new Set(['REQUEST_DENIED', 'INVALID_REQUEST', 'OVER_QUERY_LIMIT', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED']).has(String(status));
}

async function fetchPlaceDetails(placeId, key) {
  if (!placeId) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'name,formatted_address,address_components,formatted_phone_number,international_phone_number,website,url,rating,user_ratings_total,types,business_status');
  url.searchParams.set('key', key);

  try {
    const resp = await fetchWithTimeout(url, undefined, GOOGLE_FETCH_TIMEOUT_MS);
    const data = await resp.json().catch(() => ({}));
    return data && data.result ? data.result : null;
  } catch (err) {
    console.warn('place details lookup failed', err.message || err);
    return null;
  }
}

function normalizePlace(place, details, criteria, key) {
  const source = details || {};
  const address = source.formatted_address || place.formatted_address || '';
  const property = {
    propertyId: place.place_id || '',
    name: source.name || place.name || '',
    address,
    area: addressArea(source.address_components || place.address_components, criteria),
    phone: source.formatted_phone_number || source.international_phone_number || '',
    website: source.website || '',
    image: '',
    rating: typeof source.rating === 'number' ? source.rating : typeof place.rating === 'number' ? place.rating : null,
    reviewCount:
      typeof source.user_ratings_total === 'number'
        ? source.user_ratings_total
        : typeof place.user_ratings_total === 'number'
        ? place.user_ratings_total
        : null,
    directions:
      source.url ||
      (place.place_id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.place_id)}` : ''),
    category: criteria.category,
    businessStatus: source.business_status || place.business_status || '',
    types: source.types || place.types || [],
    source: 'Google Places',
  };
  return { ...property, ...scoreProperty(property, criteria) };
}

function normalizeNewPlace(place, criteria, key) {
  const photoName = place.photos && place.photos[0] && place.photos[0].name;
  const address = place.formattedAddress || '';
  const property = {
    propertyId: place.id || '',
    name: (place.displayName && place.displayName.text) || '',
    address,
    area: addressArea(newAddressComponentsToLegacy(place.addressComponents), criteria),
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || '',
    website: place.websiteUri || '',
    image: newPhotoUrl(photoName, place.id),
    rating: typeof place.rating === 'number' ? place.rating : null,
    reviewCount: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    directions: place.googleMapsUri || (place.id ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}` : ''),
    category: criteria.category,
    businessStatus: place.businessStatus || '',
    types: place.types || [],
    source: 'Google Places',
  };
  return { ...property, ...scoreProperty(property, criteria) };
}

function newAddressComponentsToLegacy(components) {
  if (!Array.isArray(components)) return [];
  return components.map((component) => ({
    long_name: component.longText || component.shortText || '',
    short_name: component.shortText || component.longText || '',
    types: component.types || [],
  }));
}

function newPhotoUrl(name, placeId) {
  const value = clean(name);
  if (!value) return '';
  const url = new URL('/.netlify/functions/google-place-image', 'https://rentready.local');
  url.searchParams.set('kind', 'new-photo');
  url.searchParams.set('name', value);
  if (placeId) url.searchParams.set('placeId', placeId);
  return localUrl(url);
}

function localUrl(url) {
  return `${url.pathname}${url.search}`;
}

async function rankWithOpenAI(properties, criteria) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return defaultRank(properties, criteria);

  try {
    const resp = await fetchWithTimeout('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        input: [
          {
            role: 'system',
            content: 'Rank verified apartment communities for rental preference fit. Do not invent factual fields. Return strict JSON with a properties array. Use only propertyId to identify items.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              category: criteria.category,
              preferences: criteria,
              properties: properties.map(({ propertyId, name, address, rating, reviewCount, phone, website }) => ({
                propertyId,
                name,
                address,
                rating,
                reviewCount,
                hasPhone: !!phone,
                hasWebsite: !!website,
              })),
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'apartment_ranking',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                properties: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      propertyId: { type: 'string' },
                      matchScore: { type: 'number' },
                      matchReasons: { type: 'array', items: { type: 'string' } },
                      summary: { type: 'string' },
                    },
                    required: ['propertyId', 'matchScore', 'matchReasons', 'summary'],
                  },
                },
              },
              required: ['properties'],
            },
          },
        },
      }),
    }, OPENAI_RANK_TIMEOUT_MS);

    const data = await resp.json();
    const text = data.output_text || (((data.output || [])[0] || {}).content || [])[0]?.text;
    const parsed = text ? JSON.parse(text) : null;
    const byId = new Map((parsed && parsed.properties ? parsed.properties : []).map((p) => [p.propertyId, p]));
    return defaultRank(properties, criteria)
      .map((p) => enrich(p, byId.get(p.propertyId)))
      .sort((a, b) => b.matchScore - a.matchScore);
  } catch (err) {
    console.error('OpenAI ranking fallback', err.message || err);
    return defaultRank(properties, criteria);
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return fetch(url, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function defaultRank(properties, criteria) {
  return properties
    .map((p) => (p.matchReasons && p.matchReasons.length && p.summary ? p : { ...p, ...scoreProperty(p, criteria) }))
    .sort((a, b) => b.matchScore - a.matchScore);
}

function isUsableCachedResult(cached, criteria) {
  if (!cached || cached.provider !== 'google_places') return false;
  if (!cached.criteria || cached.criteria.city !== criteria.city) return false;
  if (String(cached.criteria.searchArea || '') !== String(criteria.searchArea || '')) return false;
  if (Number(cached.criteria.rentBudget || 0) !== Number(criteria.rentBudget || 0)) return false;
  if (Number(cached.criteria.bedrooms ?? -1) !== Number(criteria.bedrooms ?? -1)) return false;
  const properties = Array.isArray(cached.properties) ? cached.properties : [];
  if (properties.length < MAX_RESULTS) return false;
  return properties.every((property) => {
    const website = String(property.website || '');
    const phone = String(property.phone || '');
    const image = String(property.image || '');
    return property.source === 'Google Places' && isServableListingImage(image) && !website.includes('example.com') && !/555-0\d{3}|555\d{4}/.test(phone);
  });
}

function isAnyUsableCachedResult(cached, criteria) {
  if (!cached || cached.provider !== 'google_places') return false;
  if (!cached.criteria || cached.criteria.city !== criteria.city) return false;
  if (String(cached.criteria.searchArea || '') !== String(criteria.searchArea || '')) return false;
  const properties = Array.isArray(cached.properties) ? cached.properties : [];
  return properties.some((property) => property && property.source === 'Google Places' && isServableListingImage(property.image) && property.name);
}

function isServableListingImage(image) {
  const value = String(image || '');
  return !value || (
    value.startsWith('/.netlify/functions/google-place-image?') &&
    value.includes('kind=new-photo')
  );
}

function buildCriteria(lead, _category, requestCriteria) {
  const leadLocation = clean(lead.preferred_city || lead.city);
  const parsedLeadLocation = normalizeCityState(leadLocation);
  const requestCity = clean(requestCriteria && (requestCriteria.city || requestCriteria.location || requestCriteria.area || requestCriteria.searchArea));
  const requestLocation = normalizeCityState(requestCity) || requestCity;
  const parsedLocation = parsedLeadLocation || leadLocation || requestLocation;
  const requestBudget = Number(requestCriteria && (requestCriteria.rentBudget || requestCriteria.budgetMax || requestCriteria.budget));
  const rentBudget = Number(lead.rent_budget) || (Number.isFinite(requestBudget) && requestBudget > 0 ? requestBudget : null);
  const requestBedrooms = requestCriteria && (requestCriteria.bedrooms === 0 || requestCriteria.bedrooms ? requestCriteria.bedrooms : requestCriteria.beds);
  const bedrooms = normalizeBedrooms(lead.beds_needed || requestBedrooms);
  return {
    category: RESULTS_CATEGORY,
    city: parsedLocation,
    searchArea: parsedLocation,
    locationWarning:
      parsedLocation && leadLocation && parsedLocation === leadLocation && !normalizeCityState(leadLocation)
        ? 'City/state was not normalized; Google Places will interpret the saved location text.'
        : null,
    rentBudget,
    bedrooms,
    bedroomsLabel: bedroomLabel(bedrooms),
    moveTimeline: clean(lead.move_timeline),
    moveReason: clean(lead.move_reason),
  };
}

function normalizeCityState(city) {
  const value = clean(city);
  if (!value) return '';
  const commaMatch = value.match(/^(.+?),\s*([A-Za-z]{2}|[A-Za-z][A-Za-z\s.]+)$/);
  const spaceMatch = value.match(/^(.+?)\s+([A-Za-z]{2})$/);
  const match = commaMatch || spaceMatch;
  if (!match) return '';
  const place = clean(match[1]).replace(/\s+/g, ' ');
  const state = normalizeStateCode(match[2]);
  if (!place || !VALID_STATE_CODES.has(state)) return '';
  return `${place}, ${state}`;
}

function normalizeStateCode(value) {
  const state = clean(value).replace(/\./g, '').toUpperCase();
  const names = {
    ALABAMA:'AL', ALASKA:'AK', ARIZONA:'AZ', ARKANSAS:'AR', CALIFORNIA:'CA', COLORADO:'CO', CONNECTICUT:'CT',
    DELAWARE:'DE', FLORIDA:'FL', GEORGIA:'GA', HAWAII:'HI', IDAHO:'ID', ILLINOIS:'IL', INDIANA:'IN', IOWA:'IA',
    KANSAS:'KS', KENTUCKY:'KY', LOUISIANA:'LA', MAINE:'ME', MARYLAND:'MD', MASSACHUSETTS:'MA', MICHIGAN:'MI',
    MINNESOTA:'MN', MISSISSIPPI:'MS', MISSOURI:'MO', MONTANA:'MT', NEBRASKA:'NE', NEVADA:'NV', 'NEW HAMPSHIRE':'NH',
    'NEW JERSEY':'NJ', 'NEW MEXICO':'NM', 'NEW YORK':'NY', 'NORTH CAROLINA':'NC', 'NORTH DAKOTA':'ND', OHIO:'OH',
    OKLAHOMA:'OK', OREGON:'OR', PENNSYLVANIA:'PA', 'RHODE ISLAND':'RI', 'SOUTH CAROLINA':'SC', 'SOUTH DAKOTA':'SD',
    TENNESSEE:'TN', TEXAS:'TX', UTAH:'UT', VERMONT:'VT', VIRGINIA:'VA', WASHINGTON:'WA', 'WEST VIRGINIA':'WV',
    WISCONSIN:'WI', WYOMING:'WY', 'DISTRICT OF COLUMBIA':'DC',
  };
  return names[state] || state;
}

function normalizeBedrooms(value) {
  const raw = String(value || '').split(',')[0].trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'studio') return 0;
  if (raw.includes('4')) return 4;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(4, n)) : null;
}

function bedroomLabel(bedrooms) {
  if (bedrooms === null || bedrooms === undefined) return '';
  if (bedrooms === 0) return 'studio';
  if (bedrooms >= 4) return '4 bedroom';
  return `${bedrooms} bedroom`;
}

function scoreProperty(property, criteria) {
  let score = 58;
  const text = `${property.name} ${property.address}`.toLowerCase();
  const cityTerms = clean(criteria.city)
    .toLowerCase()
    .split(/[,\s]+/)
    .filter((term) => term.length > 2);
  const cityHits = cityTerms.filter((term) => text.includes(term)).length;
  if (cityTerms.length && cityHits) score += Math.min(18, cityHits * 7);

  if (/\bapartments|apartment|homes|residences|villas|flats|lofts|townhomes|place|park|pointe|landing|station|square|commons|reserve|retreat|terrace|village/.test(text)) score += 13;

  if (typeof property.rating === 'number') score += Math.max(0, Math.min(12, Math.round((property.rating - 3.4) * 8)));
  if (property.phone) score += 4;
  if (property.website) score += 4;
  if (property.businessStatus === 'OPERATIONAL') score += 3;
  if (criteria.rentBudget && criteria.rentBudget < 1800) score += 4;
  score = Math.max(55, Math.min(98, Math.round(score)));

  const matchReasons = [
    `Searched for apartments in ${criteria.city}`,
    criteria.rentBudget
      ? `Matched against your target budget around $${criteria.rentBudget}/mo`
      : 'Matched against your saved RentReady search profile',
    criteria.bedroomsLabel ? `Bedroom preference: ${criteria.bedroomsLabel}` : 'Bedroom preference included when available',
    property.phone || property.website ? 'Contact details found through Google Places' : 'Verified through Google Places',
  ];

  return {
    matchScore: score,
    matchReasons,
    summary:
      'This verified apartment community is a strong candidate for your saved search. Contact the property to confirm current rent, availability, move-in specials, deposits, lease terms, and screening requirements.',
    availabilityNote: 'Google Places does not publish live unit availability. Call or visit the property website to confirm current openings.',
  };
}

function addressArea(components, criteria) {
  if (!Array.isArray(components)) return clean(criteria.searchArea || criteria.city);
  const priority = ['neighborhood', 'sublocality', 'sublocality_level_1', 'locality'];
  for (const type of priority) {
    const component = components.find((c) => Array.isArray(c.types) && c.types.includes(type));
    const name = clean(component && (component.long_name || component.short_name));
    if (name) return name;
  }
  return clean(criteria.searchArea || criteria.city);
}

function nearbyAreasFromProperties(properties, criteria) {
  const seen = new Set();
  const out = [];
  for (const property of properties) {
    const area = formatNearbyArea(property.area, criteria);
    if (!area || seen.has(area.toLowerCase())) continue;
    seen.add(area.toLowerCase());
    out.push(area);
    if (out.length >= 8) break;
  }
  return out;
}

function formatNearbyArea(area, criteria) {
  const value = clean(area);
  const city = clean(criteria.city);
  if (!value) return '';
  const normalizedArea = normalizeCityState(value);
  if (normalizedArea) return normalizedArea;
  if (!city) return value;
  const normalizedCity = normalizeCityState(city);
  const cityName = clean(city.split(',')[0]);
  if (normalizedCity && cityName && value.toLowerCase() === cityName.toLowerCase()) return normalizedCity;
  if (value.toLowerCase().includes(city.toLowerCase())) return value;
  return `${value}, ${city}`;
}

function enrich(property, ai) {
  if (!ai) return property;
  return {
    ...property,
    matchScore: boundedNumber(ai.matchScore, property.matchScore),
    matchReasons: Array.isArray(ai.matchReasons) ? ai.matchReasons.slice(0, 4).map(String) : property.matchReasons,
    summary: typeof ai.summary === 'string' && ai.summary.trim() ? ai.summary.trim() : property.summary,
  };
}

function boundedNumber(n, fallback) {
  const value = Number(n);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
}

function clean(value) {
  return String(value || '').trim();
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }, body: JSON.stringify(body) };
}
