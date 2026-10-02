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
  const visibleText = html.replace(/<[^>]+>/g, '');

  [
    'YOUR RENTREADY RESULTS ARE READY',
    'See Where You Stand. Then See Your Apartment Options.',
    'See what may help or hurt your next application, then continue to apartment options based on your search.',
    'Second-chance options may be included when available.',
    'Your RentReady Results Include',
    'Unlock Your Results',
    'See What May Help or Hurt Your Application',
    'See What May Need Attention Before You Apply',
    'Know What Property Managers May Look For',
    'Know What You Can Do Next',
    'Continue to Apartment Options Based on Your Search',
    'Unlock Your Results — $10',
    'See your personalized results and continue to apartment options based on your search.',
    'One-time payment • No subscription • No credit pull',
    'Secure Checkout',
    'Your payment is securely processed.',
    'UNLOCK MY RESULTS — $10',
    'Secure payment • One-time $10 • Immediate access',
    'Your Search',
    'Your Answers',
    'Unlock Results',
    'This is not a rental application, landlord approval, or guarantee of approval.',
    'RentReady Results + Apartment Options',
    'One-time payment • No subscription',
  ].forEach((text) => assert.ok(text.includes('<') ? html.includes(text) : visibleText.includes(text), `${text} should be present`));

  assert.doesNotMatch(html, /RentReady Outlook/);
  assert.doesNotMatch(html, /Questionnaire|Housing Plan|>Checkout</);
  assert.doesNotMatch(html, /One-time personalized review/);
  assert.doesNotMatch(html, /Better Your Approval odds/);
  assert.doesNotMatch(html, /View Listings/);
  // The $10 checkout stays single-purpose: no $47 kit or listings promotion.
  assert.doesNotMatch(html, /\$47|Preparation Kit|real-estate-list/);
  // The payment form must come before the legal disclaimer in source order.
  assert.ok(html.indexOf('id="payBtn"') < html.indexOf('This is not a rental application'));
}

// Questionnaire -> checkout transition copy.
const processingHtml = fs.readFileSync(path.join(root, 'app/src/pages/ResultsProcessing/page.html'), 'utf8');
const processingJs = fs.readFileSync(path.join(root, 'app/src/pages/ResultsProcessing/script-0.js'), 'utf8');
assert.match(processingHtml, /We're Getting Your <strong>Results Ready<\/strong>/);
assert.match(processingHtml, /No credit pull\. Based only on the information you provided\./);
[
  'Reviewing your answers...',
  'Checking common rental factors...',
  'Preparing your RentReady Results...',
  'Preparing your apartment search...',
  'Your RentReady Results <strong>Are Ready</strong>',
].forEach((text) => assert.ok(processingJs.includes(text), `${text} should be in the transition`));
// The transition only reflects the visitor's own answers.
const processingCopy = processingHtml + processingJs.replace(/^\s*\/\/.*$/gm, '');
assert.doesNotMatch(processingCopy, /credit report|screening report|landlord review|approved/i);

console.log('rentready checkout copy test passed');
