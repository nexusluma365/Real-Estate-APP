const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');

const root = path.join(__dirname, '..');
const blobsDir = path.join(root, '.netlify-local-blobs');
const openaiPath = require.resolve('openai');
const resolverPath = require.resolve('../netlify/functions/resolve-property-image');
const storePath = require.resolve('../netlify/functions/_lib/store');

let openAICalls = 0;
let openAIResult = {
  match: true,
  confidence: 0.94,
  imageUrl: 'https://images.officialcdn.test/property-exterior.jpg',
  sourcePageUrl: 'https://soleste.example.com/gallery',
  sourceType: 'official_site',
  reason: 'Official domain page for the exact property.',
};

class FakeOpenAI {
  constructor() {
    this.responses = {
      create: async (payload) => {
        openAICalls += 1;
        FakeOpenAI.lastPayload = payload;
        if (openAIResult instanceof Error) throw openAIResult;
        return { output_text: JSON.stringify(openAIResult) };
      },
    };
  }
}

function loadResolver() {
  delete require.cache[resolverPath];
  delete require.cache[storePath];
  require.cache[openaiPath] = {
    id: openaiPath,
    filename: openaiPath,
    loaded: true,
    exports: FakeOpenAI,
  };
  return require('../netlify/functions/resolve-property-image');
}

function response(status, body, contentType = 'text/html', headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected: false,
    headers: {
      get(name) {
        const key = String(name).toLowerCase();
        return { 'content-type': contentType, ...headers }[key] || null;
      },
    },
    text: async () => String(body || ''),
    json: async () => JSON.parse(body || '{}'),
  };
}

function imageResponse(status = 200, contentType = 'image/jpeg', length = 50000) {
  return response(status, '', contentType, { 'content-length': String(length) });
}

function event(body) {
  return { httpMethod: 'POST', body: JSON.stringify(body), queryStringParameters: {} };
}

async function reset() {
  await fs.rm(blobsDir, { recursive: true, force: true });
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.OPENAI_API_KEY = 'openai_test_key';
  openAICalls = 0;
  openAIResult = {
    match: true,
    confidence: 0.94,
    imageUrl: 'https://images.officialcdn.test/property-exterior.jpg',
    sourcePageUrl: 'https://soleste.example.com/gallery',
    sourceType: 'official_site',
    reason: 'Official domain page for the exact property.',
  };
  FakeOpenAI.lastPayload = null;
}

async function run() {
  const oldFetch = global.fetch;
  const oldOpenAI = process.env.OPENAI_API_KEY;
  const oldSupabaseUrl = process.env.SUPABASE_URL;
  const oldSupabaseSecret = process.env.SUPABASE_SECRET_KEY;
  const oldSupabaseService = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    await reset();
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      if (options.method === 'HEAD') return imageResponse();
      if (href.includes('soleste.example.com')) {
        return response(200, '<html><title>Soleste Spring Garden</title><body>Soleste Spring Garden 1005 Spring Garden Rd Miami FL 33136 gallery</body></html>');
      }
      return imageResponse();
    };

    let resolver = loadResolver();
    let res = await resolver.handler(event({
      propertyId: 'place_soleste',
      name: 'Soleste Spring Garden',
      address: '1005 Spring Garden Rd, Miami, FL 33136',
      website: 'https://soleste.example.com/',
      query: 'ignore this arbitrary browser prompt',
    }));
    let body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(body.ok, true);
    assert.equal(body.imageUrl, 'https://images.officialcdn.test/property-exterior.jpg');
    assert.equal(openAICalls, 1);
    assert.equal(JSON.stringify(FakeOpenAI.lastPayload).includes('ignore this arbitrary browser prompt'), false);
    assert.equal(JSON.stringify(FakeOpenAI.lastPayload).includes('openai_test_key'), false);

    res = await resolver.handler(event({
      propertyId: 'place_soleste',
      name: 'Soleste Spring Garden',
      address: '1005 Spring Garden Rd, Miami, FL 33136',
      website: 'https://soleste.example.com/',
    }));
    body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.cached, true);
    assert.equal(openAICalls, 1);

    await reset();
    resolver = loadResolver();
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      if (options.method === 'HEAD') return imageResponse();
      if (href.includes('manager.example.com')) {
        return response(200, '<html>Grove Central Residences 2800 SW 27th Terrace Miami FL 33133 luxury apartments</html>');
      }
      return imageResponse();
    };
    openAIResult = {
      match: true,
      confidence: 0.9,
      imageUrl: 'https://cdn.manager.example.com/grove-central-exterior.jpg',
      sourcePageUrl: 'https://manager.example.com/grove-central-residences',
      sourceType: 'property_management_site',
      reason: 'Management page names the property and matching address.',
    };
    res = await resolver.handler(event({
      propertyId: 'place_grove',
      name: 'Grove Central Residences',
      address: '2800 SW 27th Terrace, Miami, FL 33133',
      website: '',
    }));
    body = JSON.parse(res.body);
    assert.equal(body.ok, true);

    const rejectionCases = [
      {
        label: 'wrong street address',
        sourceHtml: '<html>Grove Central Residences 999 Wrong St Miami FL 33133</html>',
        candidate: { match: true, confidence: 0.92, imageUrl: 'https://cdn.manager.example.com/photo.jpg', sourcePageUrl: 'https://manager.example.com/grove', sourceType: 'management', reason: 'wrong address' },
      },
      {
        label: 'wrong city',
        sourceHtml: '<html>Grove Central Residences 2800 SW 27th Terrace Orlando FL 33133</html>',
        candidate: { match: true, confidence: 0.92, imageUrl: 'https://cdn.manager.example.com/photo.jpg', sourcePageUrl: 'https://manager.example.com/grove', sourceType: 'management', reason: 'wrong city' },
      },
      {
        label: 'similar property name',
        sourceHtml: '<html>Grove Central Lofts 2800 SW 27th Terrace Miami FL 33133</html>',
        candidate: { match: true, confidence: 0.92, imageUrl: 'https://cdn.manager.example.com/photo.jpg', sourcePageUrl: 'https://manager.example.com/other', sourceType: 'management', reason: 'similar' },
      },
      {
        label: 'stock source rejected',
        sourceHtml: '<html>Grove Central Residences 2800 SW 27th Terrace Miami FL 33133</html>',
        candidate: { match: true, confidence: 0.92, imageUrl: 'https://stock.example.com/apartment.jpg', sourcePageUrl: 'https://pinterest.com/pin/123', sourceType: 'social', reason: 'stock' },
      },
      {
        label: 'logo rejected',
        sourceHtml: '<html>Grove Central Residences 2800 SW 27th Terrace Miami FL 33133</html>',
        candidate: { match: true, confidence: 0.92, imageUrl: 'https://cdn.manager.example.com/logo.png', sourcePageUrl: 'https://manager.example.com/grove', sourceType: 'management', reason: 'logo' },
      },
      {
        label: 'localhost rejected',
        sourceHtml: '<html>Grove Central Residences 2800 SW 27th Terrace Miami FL 33133</html>',
        candidate: { match: true, confidence: 0.92, imageUrl: 'https://localhost/photo.jpg', sourcePageUrl: 'https://manager.example.com/grove', sourceType: 'management', reason: 'private' },
      },
    ];

    for (const item of rejectionCases) {
      await reset();
      resolver = loadResolver();
      openAIResult = item.candidate;
      global.fetch = async (url, options = {}) => {
        const href = String(url);
        if (options.method === 'HEAD') return imageResponse();
        if (href.includes('manager.example.com') || href.includes('pinterest.com')) return response(200, item.sourceHtml);
        return imageResponse();
      };
      res = await resolver.handler(event({
        propertyId: `place_${item.label.replace(/\W+/g, '_')}`,
        name: 'Grove Central Residences',
        address: '2800 SW 27th Terrace, Miami, FL 33133',
        website: '',
      }));
      body = JSON.parse(res.body);
      assert.equal(body.ok, false, item.label);
    }

    await reset();
    resolver = loadResolver();
    openAIResult = { match: true, confidence: 0.93, imageUrl: 'https://cdn.manager.example.com/tiny.jpg', sourcePageUrl: 'https://manager.example.com/grove', sourceType: 'management', reason: 'tiny' };
    global.fetch = async (url, options = {}) => {
      if (options.method === 'HEAD') return imageResponse(200, 'image/jpeg', 100);
      if (String(url).includes('manager.example.com')) return response(200, '<html>Grove Central Residences 2800 SW 27th Terrace Miami FL 33133</html>');
      return imageResponse(200, 'image/jpeg', 100);
    };
    res = await resolver.handler(event({ propertyId: 'tiny', name: 'Grove Central Residences', address: '2800 SW 27th Terrace, Miami, FL 33133' }));
    body = JSON.parse(res.body);
    assert.equal(body.ok, false);

    await reset();
    resolver = loadResolver();
    openAIResult = { match: false, confidence: 0, imageUrl: '', sourcePageUrl: '', sourceType: '', reason: 'no result' };
    global.fetch = async () => imageResponse();
    res = await resolver.handler(event({ propertyId: 'none', name: 'No Photo Apartments', address: '1 Main St, Miami, FL 33101' }));
    body = JSON.parse(res.body);
    assert.equal(body.ok, false);
    assert.equal(openAICalls, 1);
    res = await resolver.handler(event({ propertyId: 'none', name: 'No Photo Apartments', address: '1 Main St, Miami, FL 33101' }));
    body = JSON.parse(res.body);
    assert.equal(body.ok, false);
    assert.equal(body.cached, true);
    assert.equal(openAICalls, 1);

    await reset();
    resolver = loadResolver();
    openAIResult = new Error('OpenAI timeout');
    res = await resolver.handler(event({ propertyId: 'timeout', name: 'Timeout Apartments', address: '2 Main St, Miami, FL 33101' }));
    body = JSON.parse(res.body);
    assert.equal(body.ok, false);

    await reset();
    resolver = loadResolver();
    delete process.env.OPENAI_API_KEY;
    res = await resolver.handler(event({ propertyId: 'missing_key', name: 'Missing Key Apartments', address: '3 Main St, Miami, FL 33101' }));
    body = JSON.parse(res.body);
    assert.equal(body.ok, false);
    assert.equal(openAICalls, 0);

    await reset();
    resolver = loadResolver();
    res = await resolver.handler({ httpMethod: 'POST', body: '{bad json' });
    assert.equal(res.statusCode, 400);
    res = await resolver.handler(event({ query: 'luxury apartments miami' }));
    assert.equal(res.statusCode, 400);

    const { _internals } = resolver;
    assert.equal(_internals.privateHostname('localhost'), true);
    assert.equal(_internals.privateHostname('127.0.0.1'), true);
    assert.equal(_internals.privateHostname('10.0.0.2'), true);
    assert.equal(_internals.privateHostname('public.example.com'), false);
  } finally {
    global.fetch = oldFetch;
    if (oldOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAI;
    if (oldSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldSupabaseUrl;
    if (oldSupabaseSecret === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = oldSupabaseSecret;
    if (oldSupabaseService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldSupabaseService;
  }
}

run()
  .then(() => console.log('resolve property image test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
