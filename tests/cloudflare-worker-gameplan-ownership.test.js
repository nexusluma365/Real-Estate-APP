// The download worker must apply the same Game Plan ownership rule as the
// Netlify functions: its own paidGameplan flag (or a legacy paid27 record
// with no apartment category) — never an apartment purchase's paid27.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function loadHasEntitlement() {
  const source = fs
    .readFileSync('cloudflare/download-email-worker/src/worker.js', 'utf8')
    .replace(/export default\s*\{/, 'module.exports.default = {');
  const context = { module: { exports: {} }, exports: {}, console, URL, Request, Response, Headers, TextEncoder, TextDecoder, crypto };
  vm.runInNewContext(`${source}\nmodule.exports.hasEntitlement = hasEntitlement;`, context);
  return context.module.exports.hasEntitlement;
}

test('worker Game Plan ownership', () => {
  const hasEntitlement = loadHasEntitlement();
  const def = { entitlementField: 'paid27' };
  const row = (columns, raw) => ({ ...columns, raw_entitlement: raw });
  assert.equal(hasEntitlement(row({ paid27: false }, { paidGameplan: true }), 'gameplan', def), true);
  assert.equal(hasEntitlement(row({ paid27: true }, { purchasedCategories: [] }), 'gameplan', def), true, 'legacy Game Plan');
  assert.equal(hasEntitlement(row({ paid27: true }, { purchasedCategories: ['modern'] }), 'gameplan', def), false, 'apartment buyers do not get it free');
  assert.equal(hasEntitlement(row({ paid27: false }, {}), 'gameplan', def), false);
});
