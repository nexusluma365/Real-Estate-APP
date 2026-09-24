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
    'See Your Rental Approval Odds Before You Apply.',
    'Save money on Application Fees',
    'Your Personalized RentReady Check Is Ready',
    'Continue to Your Approval Odds',
    'Your Rental Readiness Check',
    'Personalized RentReady Check',
    'See Your Rental Readiness Outlook',
    'See What May Need Attention',
    'Know What to Prepare Before Applying',
    'Know What to Ask Before You Apply',
    'Plus: See your next recommended step based on the information you provided.',
    'This is not a rental application, landlord approval, or guarantee of approval.',
  ].forEach((text) => assert.ok(html.includes(text), `${text} should be present`));

  assert.doesNotMatch(html, /RentReady Outlook/);
  assert.doesNotMatch(html, /One-time personalized review/);
  assert.doesNotMatch(html, /Better Your Approval odds/);
  assert.doesNotMatch(html, /View Listings/);
}

console.log('rentready checkout copy test passed');
