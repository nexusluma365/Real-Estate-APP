const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [
  'app/src/pages/RentreadyReviewCheckout/page.html',
];

for (const file of files) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');

  assert.doesNotMatch(html, /<span class="field-label">Country<\/span>/);
  assert.doesNotMatch(html, /<div class="country-field">United States<\/div>/);

  [
    'Your Next Step Before Touring',
    'SEE MY RENTREADY REVIEW — $10',
    'See Your Rental Readiness Score',
    'See What Property Managers Look For',
    'Prepare for Better Approval Odds',
    'Schedule Your Next Tour with Confidence',
  ].forEach((text) => assert.ok(html.includes(text), `${text} should be present`));

  assert.doesNotMatch(html, /RentReady Outlook/);
  assert.doesNotMatch(html, /One-time personalized review/);
  assert.doesNotMatch(html, /Better Your Approval odds/);
  assert.doesNotMatch(html, /View Listings/);
}

console.log('rentready checkout copy test passed');
