import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../rentready-finder/netlify/functions/finder-api.mjs';

const originalFetch = globalThis.fetch;
const originalPlacesKey = process.env.GOOGLE_PLACES_API_KEY;
const originalMapsKey = process.env.GOOGLE_MAPS_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPlacesKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = originalPlacesKey;
  if (originalMapsKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = originalMapsKey;
});

async function callAutocomplete() {
  const result = await handler({
    httpMethod: 'GET',
    path: '/finder/api/locations/autocomplete',
    queryStringParameters: { q: 'Charlotte' },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), [{
    placeId: 'place_test_1',
    primaryText: 'Charlotte',
    secondaryText: 'North Carolina',
  }]);
}

for (const [variable, key] of [
  ['GOOGLE_PLACES_API_KEY', 'places-test-key'],
  ['GOOGLE_MAPS_API_KEY', 'maps-test-key'],
]) {
  test(`Finder API reads its Google Places key from ${variable}`, async () => {
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_MAPS_API_KEY;
    process.env[variable] = key;
    globalThis.fetch = async (_url, init) => {
      assert.equal(new Headers(init.headers).get('X-Goog-Api-Key'), key);
      return new Response(JSON.stringify({
        suggestions: [{
          placePrediction: {
            placeId: 'place_test_1',
            structuredFormat: {
              mainText: { text: 'Charlotte' },
              secondaryText: { text: 'North Carolina' },
            },
          },
        }],
      }));
    };
    await callAutocomplete();
  });
}
