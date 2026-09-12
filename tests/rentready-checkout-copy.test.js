const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [
  'app/src/pages/RentreadyReviewCheckout/page.html',
  'rentready-review-checkout.html',
];

for (const file of files) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');

  assert.doesNotMatch(html, /<span class="field-label">Country<\/span>/);
  assert.doesNotMatch(html, /<div class="country-field">United States<\/div>/);

  [
    'Review Eligibility',
    'See What Property Managers Look For',
    'Increase Your Approval Odds',
    'Schedule Your Next Tour with Confidence',
  ].forEach((text) => assert.match(html, new RegExp(text)));

  assert.doesNotMatch(html, /Better Your Approval odds/);
  assert.doesNotMatch(html, /View Listings/);
}

console.log('rentready checkout copy test passed');
