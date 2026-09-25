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

function details(photoName) {
  return response(200, { photos: photoName ? [{ name: photoName }] : [] });
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

async function run() {
  const oldFetch = global.fetch;
  const oldKey = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = 'google_test_key';

  try {
    let requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return image('image/jpeg');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_a/photos/photo_1', placeId: 'place_a' } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['Content-Type'], 'image/jpeg');
      assert.equal(res.isBase64Encoded, true);
      assert.equal(Buffer.from(res.body, 'base64').toString(), 'image-bytes');
      assert.equal(requests.length, 1);
      assert.match(requests[0].url, /places\/place_a\/photos\/photo_1\/media/);
      assert.match(requests[0].url, /maxWidthPx=1200/);
      assert.match(requests[0].url, /maxHeightPx=800/);
      assert.match(requests[0].url, /skipHttpRedirect=false/);
      assert.match(requests[0].url, /key=google_test_key/);
      assert.equal(requests[0].options.method, 'GET');
      assert.equal(requests[0].options.redirect, 'follow');
    });

    requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return image('image/webp', 'webp-bytes');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_webp/photos/photo_1', placeId: 'place_webp' } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['Content-Type'], 'image/webp');
      assert.equal(Buffer.from(res.body, 'base64').toString(), 'webp-bytes');
    });

    requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      if (requests.length === 1) return response(403, { error: { message: 'expired photo' } });
      if (requests.length === 2) return details('places/place_b/photos/fresh');
      return image('image/jpeg', 'fresh-bytes');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_b/photos/expired', placeId: 'place_b' } });
      assert.equal(res.statusCode, 200);
      assert.equal(Buffer.from(res.body, 'base64').toString(), 'fresh-bytes');
      assert.equal(requests.length, 3);
      assert.match(requests[1].url, /\/v1\/places\/place_b$/);
      assert.equal(requests[1].options.headers['X-Goog-FieldMask'], 'photos');
      assert.match(requests[2].url, /places\/place_b\/photos\/fresh\/media/);
    });

    requests = [];
    global.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      return requests.length === 1 ? details('places/place_c/photos/fresh') : image();
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: 'place_c' } });
      assert.equal(res.statusCode, 200);
      assert.equal(requests.length, 2);
    });

    requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      return details('');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { placeId: 'place_d' } });
      assert.equal(res.statusCode, 204);
      assert.equal(requests.length, 1);
    });

    for (const status of [400, 403, 404]) {
      requests = [];
      global.fetch = async (url) => {
        requests.push(String(url));
        return response(status, { error: { message: `media ${status}` } });
      };
      await withHandler(async (handler) => {
        const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: `places/place_${status}/photos/bad` } });
        assert.equal(res.statusCode, 204);
        assert.equal(requests.length, 2);
      });
    }

    requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      return response(200, { message: 'not an image' }, 'application/json');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_json/photos/photo_1' } });
      assert.equal(res.statusCode, 204);
      assert.equal(requests.length, 2);
    });

    requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      return requests.length === 1
        ? response(200, { photoUri: 'https://lh3.googleusercontent.com/photo-test' }, 'application/json')
        : image('image/jpeg', 'photo-uri-bytes');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_uri/photos/photo_1' } });
      assert.equal(res.statusCode, 200);
      assert.equal(Buffer.from(res.body, 'base64').toString(), 'photo-uri-bytes');
      assert.equal(requests.length, 2);
      assert.match(requests[1], /^https:\/\/lh3\.googleusercontent\.com\/photo-test/);
    });

    requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      return requests.length === 1
        ? response(200, { photoUri: 'https://lh3.googleusercontent.com/photo-test' }, 'application/json')
        : response(200, 'html', 'text/html');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_bad_uri/photos/photo_1' } });
      assert.equal(res.statusCode, 204);
      assert.equal(requests.length, 3);
    });

    requests = [];
    global.fetch = async () => image('image/jpeg', '');
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_empty/photos/photo_1' } });
      assert.equal(res.statusCode, 204);
    });

    requests = [];
    global.fetch = async () => {
      requests.push('should-not-run');
      return image();
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'bad-photo-name' } });
      assert.equal(res.statusCode, 400);
      assert.equal(requests.length, 0);
    });

    const savedKey = process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.GOOGLE_PLACES_API_KEY;
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_no_key/photos/photo_1' } });
      assert.equal(res.statusCode, 503);
    });
    process.env.GOOGLE_PLACES_API_KEY = savedKey;

    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: {} });
      assert.equal(res.statusCode, 400);
    });

    requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      if (requests.length === 1) return response(404, { error: { message: 'expired cached photo name' } });
      if (requests.length === 2) return details('places/place_heal/photos/fresh');
      return image('image/png', 'healed-bytes');
    };
    await withHandler(async (handler) => {
      const res = await handler({ httpMethod: 'GET', queryStringParameters: { photoName: 'places/place_heal/photos/expired', placeId: 'place_heal' } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['Content-Type'], 'image/png');
      assert.equal(Buffer.from(res.body, 'base64').toString(), 'healed-bytes');
      assert.match(requests[2], /places\/place_heal\/photos\/fresh\/media/);
    });

    const frontendHtml = '<img src="/.netlify/functions/google-place-image?placeId=place_a&photoName=places%2Fplace_a%2Fphotos%2Fphoto_1" />';
    assert.equal(frontendHtml.includes('google_test_key'), false);
    assert.equal(requests.some((url) => /streetview/i.test(url)), false);
    assert.equal(requests.some((url) => /maps\.googleapis\.com\/maps\/api\/place\/photo/i.test(url)), false);
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
