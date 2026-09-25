const assert = require('assert');

function response(status, body = '', contentType = 'application/json', options = {}) {
  const bytes = options.bytes === undefined ? 'image-bytes' : options.bytes;
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: !!options.redirected,
    headers: { get: () => contentType },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => (typeof body === 'string' ? JSON.parse(body || '{}') : body),
    arrayBuffer: async () => Buffer.from(bytes),
  };
}

function image(type = 'image/jpeg', bytes = 'image-bytes') {
  return response(200, '', type, { bytes, redirected: true });
}

function details(photoReference) {
  return response(200, {
    photos: photoReference ? [{ name: `places/test_place/photos/${photoReference}` }] : [],
  });
}

async function loadHandler() {
  const functionPath = require.resolve('../netlify/functions/google-place-image');
  delete require.cache[functionPath];
  return require('../netlify/functions/google-place-image').handler;
}

async function withHandler(fn) {
  const handler = await loadHandler();
  return fn(handler);
}

function assertPlaceDetailsRequest(request, placeId) {
  assert.match(request.url, /places\.googleapis\.com\/v1\/places\//);
  const parsed = new URL(request.url);
  assert.match(parsed.pathname, /^\/v1\/places\/[^/]+$/);
  assert.equal(request.options.headers['X-Goog-FieldMask'], 'photos');
  assert.equal(request.options.headers['X-Goog-Api-Key'], 'google_test_key');
  assert.equal(request.options.method, 'GET');
}

function assertPhotoMediaRequest(request, photoReference) {
  assert.match(request.url, /places\.googleapis\.com\/v1\/places\/test_place\/photos\//);
  const parsed = new URL(request.url);
  assert.equal(parsed.searchParams.get('maxWidthPx'), '1200');
  assert.equal(parsed.searchParams.get('maxHeightPx'), '800');
  assert.equal(parsed.searchParams.get('skipHttpRedirect'), 'false');
  assert.equal(parsed.searchParams.get('key'), 'google_test_key');
  assert.equal(request.options.method, 'GET');
  assert.equal(request.options.redirect, 'follow');
}

async function run() {
  const oldFetch = global.fetch;
  const oldKey = process.env.GOOGLE_PLACES_API_KEY;
  const oldLog = console.log;
  const oldWarn = console.warn;
  process.env.GOOGLE_PLACES_API_KEY = 'google_test_key';

  const logs = [];
  const warnings = [];
  console.log = (...args) => logs.push(args);
  console.warn = (...args) => warnings.push(args);

  try {
    let requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? details('fresh_photo_reference')
        : image('image/jpeg', 'fresh-image-bytes');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: 'place_missing' } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['Content-Type'], 'image/jpeg');
      assert.equal(res.headers['Cache-Control'], 'public, max-age=86400');
      assert.equal(res.isBase64Encoded, true);
      assert.equal(Buffer.from(res.body, 'base64').toString(), 'fresh-image-bytes');
      assert.equal(requests.length, 2);
      assertPlaceDetailsRequest(requests[0], 'place_missing');
      assertPhotoMediaRequest(requests[1], 'fresh_photo_reference');
      assert.deepEqual(logs.map((entry) => entry[0]).slice(-3), [
        'PHOTO PLACE DETAILS',
        'PHOTO MEDIA RESPONSE',
        'PHOTO FINAL IMAGE',
      ]);
    });

    requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? details('fresh_photo_reference')
        : image('image/webp', 'webp-bytes');
    };
    await withHandler(async (handler) => {
      const res = await handler({
        httpMethod: 'GET',
        queryStringParameters: {
          placeId: 'place_stale',
          photoName: 'places/place_stale/photos/stale_photo_reference',
        },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['Content-Type'], 'image/webp');
      assert.equal(Buffer.from(res.body, 'base64').toString(), 'webp-bytes');
      assertPlaceDetailsRequest(requests[0], 'place_stale');
      assertPhotoMediaRequest(requests[1], 'fresh_photo_reference');
      assert.match(requests[1].url, /places\/test_place\/photos\/fresh_photo_reference/);
    });

    requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return details('');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: 'place_no_photos' } });
      assert.equal(res.statusCode, 204);
      assert.equal(requests.length, 1);
      assertPlaceDetailsRequest(requests[0], 'place_no_photos');
    });

    for (const status of [400, 403, 404]) {
      requests = [];
      global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? details(`fresh_photo_reference_${status}`)
        : response(status, { error: { message: `media ${status}` } });
      };
      await withHandler(async (handler) => {
        const res = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: `place_${status}` } });
        assert.equal(res.statusCode, 204);
        assert.equal(requests.length, 2);
        assertPlaceDetailsRequest(requests[0], `place_${status}`);
        assertPhotoMediaRequest(requests[1], `fresh_photo_reference_${status}`);
      });
    }

    requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? details('fresh_photo_reference_json')
        : response(200, { photoUri: 'https://lh3.googleusercontent.com/not-used' }, 'application/json');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: 'place_json' } });
      assert.equal(res.statusCode, 204);
      assert.equal(requests.length, 2);
      assert.equal(requests.some((request) => /lh3\.googleusercontent\.com/.test(request.url)), false);
    });

    requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? details('fresh_photo_reference_html')
        : response(200, '<html></html>', 'text/html');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: 'place_html' } });
      assert.equal(res.statusCode, 204);
      assert.equal(requests.length, 2);
    });

    requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1
        ? details('fresh_photo_reference_empty')
        : image('image/jpeg', '');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: 'place_empty' } });
      assert.equal(res.statusCode, 204);
      assert.equal(requests.length, 2);
    });

    requests = [];
    global.fetch = async () => {
      requests.push({ url: 'should-not-run', options: {} });
      return image();
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'legacy_photo_reference_without_place' } });
      assert.equal(res.statusCode, 400);
      assert.equal(requests.length, 0);
    });

    const savedKey = process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: 'place_no_key' } });
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.includes('google_test_key'), false);
    });
    process.env.GOOGLE_PLACES_API_KEY = savedKey;

    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: {} });
      assert.equal(res.statusCode, 400);
    });

    const frontendHtml = '<img src="/.netlify/functions/google-place-image?placeId=place_a" />';
    assert.equal(frontendHtml.includes('google_test_key'), false);
    assert.equal(requests.some((request) => /streetview/i.test(request.url)), false);
    assert.equal(logs.some((entry) => JSON.stringify(entry).includes('PHOTO FINAL IMAGE')), true);
    assert.equal(JSON.stringify(logs).includes('google_test_key'), false);
    assert.equal(JSON.stringify(warnings).includes('google_test_key'), false);
  } finally {
    console.log = oldLog;
    console.warn = oldWarn;
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
