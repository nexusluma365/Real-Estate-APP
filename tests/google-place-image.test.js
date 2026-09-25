const assert = require('assert');

function response(status, body = '', contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => contentType },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body),
    json: async () => typeof body === 'string' ? JSON.parse(body || '{}') : body,
    arrayBuffer: async () => Buffer.from('image-bytes'),
  };
}

async function loadHandler() {
  const functionPath = require.resolve('../netlify/functions/google-place-image');
  delete require.cache[functionPath];
  return require('../netlify/functions/google-place-image').handler;
}

async function run() {
  const oldFetch = global.fetch;
  const oldKey = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = 'google_test_key';

  try {
    let requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return response(200, '', 'image/jpeg');
    };
    let handler = await loadHandler();
    const fresh = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_a/photos/photo_1', placeId: 'place_a' } });
    assert.equal(fresh.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /maxWidthPx=1200/);
    assert.match(requests[0].url, /maxHeightPx=800/);
    assert.match(requests[0].url, /skipHttpRedirect=false/);
    assert.match(requests[0].url, /key=google_test_key/);
    assert.equal(requests[0].options.method, 'GET');
    assert.equal(requests[0].options.redirect, 'follow');

    requests = [];

    requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      return response(200, '', 'application/json');
    };
    handler = await loadHandler();
    const nonImage = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_non_image/photos/photo_1' } });
    assert.equal(nonImage.statusCode, 204);
    assert.equal(requests.length, 2);

    requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      if (requests.length === 1) return response(403, { error: { message: 'expired photo' } });
      if (requests.length === 2) return response(200, { photos: [{ name: 'places/place_b/photos/fresh' }] });
      return response(200, '', 'image/jpeg');
    };
    handler = await loadHandler();
    const refreshed = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_b/photos/expired', placeId: 'place_b' } });
    assert.equal(refreshed.statusCode, 200);
    assert.equal(requests.length, 3);
    assert.match(requests[1].url, /\/v1\/places\/place_b$/);
    assert.equal(requests[1].options.headers['X-Goog-FieldMask'], 'photos');
    assert.match(requests[2].url, /places\/place_b\/photos\/fresh\/media/);

    requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      return requests.length === 1
        ? response(200, { photos: [{ name: 'places/place_c/photos/fresh' }] })
        : response(200, '', 'image/jpeg');
    };
    handler = await loadHandler();
    const noName = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: 'place_c' } });
    assert.equal(noName.statusCode, 200);
    assert.equal(requests.length, 2);

    requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      return response(200, { photos: [] });
    };
    handler = await loadHandler();
    const noPhoto = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: 'place_d' } });
    assert.equal(noPhoto.statusCode, 204);
    assert.equal(requests.length, 1);

    requests = [];
    global.fetch = async () => response(403, { error: { message: 'permission denied' } });
    handler = await loadHandler();
    const forbidden = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_e/photos/expired', placeId: 'place_e' } });
    assert.equal(forbidden.statusCode, 204);

    requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      if (requests.length === 1) return response(400, { error: { message: 'invalid photo' } });
      if (requests.length === 2) return response(200, { photos: [{ name: 'places/place_f/photos/fresh' }] });
      return response(200, '', 'image/jpeg');
    };
    handler = await loadHandler();
    const badRequest = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_f/photos/expired', placeId: 'place_f' } });
    assert.equal(badRequest.statusCode, 200);
    assert.equal(requests.length, 3);

    assert.equal(requests.some((url) => /street/i.test(url)), false);
    assert.equal(JSON.stringify({ html: '<img src="/.netlify/functions/google-place-image?placeId=place_a" />' }).includes('google_test_key'), false);
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
