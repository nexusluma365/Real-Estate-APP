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
  'fArea',
  'fStyle',
  'Update my search',
  'Adjust my search',
].forEach((text) => {
  assert.doesNotMatch(html, new RegExp(text), `${text} should not be rendered on the apartment listing page`);
});

[
  'openPanelBtn',
  'panelOverlay',
  'applySearchBtn',
  'emptyAdjustBtn',
  'fArea',
  'fStyle',
].forEach((text) => {
  assert.doesNotMatch(js, new RegExp(text), `${text} should not be referenced by listing JavaScript`);
});

assert.match(js, /statuses:\s*\["upsell-success",\s*"upsell-declined"\]/);

console.log('real estate list search controls test passed');
