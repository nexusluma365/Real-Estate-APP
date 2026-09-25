const assert = require('assert');

async function run() {
  const functionPath = require.resolve('../netlify/functions/google-place-image');
  delete require.cache[functionPath];
  const handler = require('../netlify/functions/google-place-image').handler;
  const oldFetch = global.fetch;
  const oldKey = process.env.GOOGLE_PLACES_API_KEY;
  const requests = [];
  process.env.GOOGLE_PLACES_API_KEY = 'google_test_key';

  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => Buffer.from('image-bytes'),
    };
  };

  try {
    const response = await handler({
      httpMethod: 'GET',
      queryStringParameters: {
        kind: 'new-photo',
        name: 'places/place_miami/photos/photo_1',
        placeId: 'place_miami',
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.isBase64Encoded, true);
    assert.match(requests[0].url, /^https:\/\/places\.googleapis\.com\/v1\/places\/place_miami\/photos\/photo_1\/media\?maxWidthPx=900$/);
    assert.equal(requests[0].options.headers['X-Goog-Api-Key'], 'google_test_key');
    assert.doesNotMatch(requests[0].url, /street/i);

    const rejected = await handler({
      httpMethod: 'GET',
      queryStringParameters: { kind: 'panorama', location: 'Miami, FL' },
    });
    assert.equal(rejected.statusCode, 400);
    assert.equal(requests.length, 1);
  } finally {
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = oldKey;
  }
}

run()
  .then(() => console.log('google place image test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
