const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/src/pages/RealEstateList/page.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app/src/pages/RealEstateList/script-0.js'), 'utf8');

[
  'openPanelBtn',
  'panelOverlay',
  'closePanelBtn',
  'applySearchBtn',
  'emptyAdjustBtn',
  'emptyExpandBtn',
  'fArea',
  'fStyle',
  'Update my search',
  'Adjust my search',
  'Expand search area',
  'Update your city and state',
].forEach((text) => {
  assert.doesNotMatch(html, new RegExp(text), `${text} should not be rendered on the apartment listing page`);
});

[
  'openPanelBtn',
  'panelOverlay',
  'applySearchBtn',
  'emptyAdjustBtn',
  'emptyExpandBtn',
  'fArea',
  'fStyle',
].forEach((text) => {
  assert.doesNotMatch(js, new RegExp(text), `${text} should not be referenced by listing JavaScript`);
});

assert.match(js, /statuses:\s*\["upsell-success",\s*"upsell-declined"\]/);
assert.match(js, /APARTMENT_RESULTS_TIMEOUT_MS\s*=\s*52000/);
assert.match(html, /Reload verified matches/);
assert.match(js, /function hideProperty\(id\)/);
assert.match(js, /function shareProperty\(id\)/);
assert.match(js, /onclick="shareProperty\('\$\{apt\.id\}'\)"/);
assert.match(js, /onclick="hideProperty\('\$\{apt\.id\}'\)"/);

console.log('real estate list search controls test passed');
