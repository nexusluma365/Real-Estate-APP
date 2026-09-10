const assert = require('assert');
const fs = require('fs/promises');
const path = require('path');

// Exercises the real _lib/store.js (not a stub) against its local Netlify
// Blobs fallback, which is what runs in `netlify dev` / any environment
// without SUPABASE_URL configured. Regression coverage for: buying a second
// apartment category must not drop entitlement to the first one, and old
// records written before `purchasedCategories` existed must still resolve
// correctly from their legacy single `purchasedCategory` value.
async function run() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const storePath = require.resolve('../netlify/functions/_lib/store');
  delete require.cache[storePath];
  const { getEntitlements, patchEntitlements } = require('../netlify/functions/_lib/store');

  const blobsDir = path.join(process.cwd(), '.netlify-local-blobs');
  await fs.rm(blobsDir, { recursive: true, force: true });

  try {
    const leadId = `lead_test_${Date.now()}`;

    const fresh = await getEntitlements(leadId);
    assert.deepEqual(fresh.purchasedCategories, []);
    assert.equal(fresh.purchasedCategory, null);

    await patchEntitlements(leadId, { paid27: true, addPurchasedCategory: 'modern' });
    const afterModern = await getEntitlements(leadId);
    assert.deepEqual(afterModern.purchasedCategories, ['modern']);
    assert.equal(afterModern.purchasedCategory, 'modern');

    // Buying luxury next must keep modern, not replace it.
    await patchEntitlements(leadId, { addPurchasedCategory: 'luxury' });
    const afterBoth = await getEntitlements(leadId);
    assert.deepEqual(afterBoth.purchasedCategories, ['modern', 'luxury']);
    assert.equal(afterBoth.purchasedCategory, 'luxury');
    assert.equal(afterBoth.paid27, true, 'unrelated flags set earlier must survive the second patch');

    // Buying the same category again must not create a duplicate entry.
    await patchEntitlements(leadId, { addPurchasedCategory: 'modern' });
    const afterRepeat = await getEntitlements(leadId);
    assert.deepEqual(afterRepeat.purchasedCategories, ['modern', 'luxury']);

    // A record written by pre-fix code only ever had the singular field.
    const legacyLeadId = `lead_legacy_${Date.now()}`;
    const legacyPath = path.join(blobsDir, 'rrn-entitlements', encodeURIComponent(legacyLeadId));
    await fs.mkdir(path.dirname(legacyPath), { recursive: true });
    await fs.writeFile(legacyPath, JSON.stringify({ leadId: legacyLeadId, paid27: true, purchasedCategory: 'luxury' }));
    const legacy = await getEntitlements(legacyLeadId);
    assert.deepEqual(legacy.purchasedCategories, ['luxury']);
    assert.equal(legacy.purchasedCategory, 'luxury');
  } finally {
    await fs.rm(blobsDir, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log('entitlements store categories test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
