const assert = require('assert');

async function loadHandler(entitlements) {
  const storePath = require.resolve('../netlify/functions/_lib/store');
  const fnPath = require.resolve('../netlify/functions/get-entitlements');
  delete require.cache[fnPath];

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getEntitlements: async () => entitlements,
    },
  };

  return require('../netlify/functions/get-entitlements').handler;
}

async function run() {
  const kitOnlyHandler = await loadHandler({
    paid10: true,
    paid27: true,
    paid47: true,
    paid97: false,
    purchasedCategory: 'apartment_prep',
    purchasedCategories: ['apartment_prep'],
  });
  const kitOnlyRes = await kitOnlyHandler({
    httpMethod: 'GET',
    queryStringParameters: { leadId: 'lead_kit' },
  });
  const kitOnly = JSON.parse(kitOnlyRes.body);
  assert.equal(kitOnlyRes.statusCode, 200);
  assert.equal(kitOnly.paid10, true);
  assert.equal(kitOnly.paid27, false);
  assert.equal(kitOnly.paid47, true);
  assert.deepEqual(kitOnly.purchasedCategories, ['apartment_prep']);

  const legacyApartmentHandler = await loadHandler({
    paid10: true,
    paid27: true,
    paid47: false,
    paid97: false,
    purchasedCategory: 'modern',
    purchasedCategories: ['modern'],
  });
  const legacyRes = await legacyApartmentHandler({
    httpMethod: 'GET',
    queryStringParameters: { leadId: 'lead_modern' },
  });
  const legacy = JSON.parse(legacyRes.body);
  assert.equal(legacyRes.statusCode, 200);
  assert.equal(legacy.paid27, true);
  assert.equal(legacy.paid47, false);
}

run()
  .then(() => console.log('get-entitlements public flags test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
