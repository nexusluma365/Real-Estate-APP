const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mockupPath = path.join(root, 'app/public/rentready-guide-mockup.png');
const pages = [
  'app/src/pages/ModernApartmentsPremium/page.html',
  'app/src/pages/LuxuryApartmentsPremium/page.html',
];
const stylesheets = [
  'app/src/pages/ModernApartmentsPremium/page.css',
  'app/src/pages/LuxuryApartmentsPremium/page.css',
];

assert.ok(fs.existsSync(mockupPath), 'RentReady guide mockup asset should exist in app/public');

for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  assert.ok(html.includes('src="/rentready-guide-mockup.png"'), `${page} should render the RentReady Guide mockup`);
  assert.ok(html.includes('class="guide-mockup-image"'), `${page} should use the guide mockup image class`);
  assert.ok(!html.includes('<div class="book">'), `${page} should not render the old CSS book mockup`);
  assert.ok(!html.includes('class="mockup-photo"'), `${page} should not render the old preview photo overlay`);
  assert.ok(!html.includes('LEASING<br>GUIDE'), `${page} should not render the old leasing guide text mockup`);
}

for (const stylesheet of stylesheets) {
  const css = fs.readFileSync(path.join(root, stylesheet), 'utf8');
  assert.ok(css.includes('.guide-mockup-image'), `${stylesheet} should style the guide mockup image`);
  assert.ok(css.includes('drop-shadow'), `${stylesheet} should give the guide mockup a premium shadow`);
  assert.ok(!css.includes('.book{'), `${stylesheet} should not keep old book mockup styles`);
  assert.ok(!css.includes('.mockup-photo'), `${stylesheet} should not keep old photo overlay styles`);
}

console.log('Premium guide mockup checks passed.');
