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
    'Your RentReady Check Is Ready',
    'See What Could Help or Hurt Your Next Apartment Application',
    'We reviewed the answers you provided. Unlock your personalized RentReady Check to see what looks good, what may need attention, and what to prepare before you spend money on your next application.',
    'Save money on Application Fees',
    'Your RentReady Check Includes',
    'Know What Property Managers Look For on Applications',
    'See the things they may check before saying yes or no.',
    'See Your Chance of Approval Before You Apply',
    'Know where you stand before wasting money on application fees.',
    'See What Could Stop You From Getting Approved',
    'Find out what may cause a problem before you apply.',
    'Know What You Can Do Next',
    'See simple steps that may help you get ready for your next application.',
    'See Apartment Listings That Fit Your Search',
    'Find apartments in the area you chose, including second-chance options when available.',
    'Unlock Your Results — $10',
    'See your chances, what could hold you back, and apartments that fit your search.',
    'One-time payment. No subscription. No credit pull.',
    'Secure Checkout',
    'Your payment is securely processed.',
    'Unlock My RentReady Check — $10',
    'Secure payment • One-time $10 charge • Immediate access',
    'Your Rental Readiness Check',
    'Personalized RentReady Check',
    'This is not a rental application, landlord approval, or guarantee of approval.',
    // Mobile-only compact copy.
    'We reviewed your answers. Unlock your personalized RentReady Check to see where you stand before your next apartment application.',
    'See Apartments That Fit Your Search',
    'Second-chance options when available.',
    'See your results and apartments that fit your search.',
    'One-time payment • No subscription • No credit pull',
    'Based on the answers you just provided.',
  ].forEach((text) => assert.ok(text.includes('<') ? html.includes(text) : visibleText.includes(text), `${text} should be present`));

  assert.doesNotMatch(html, /RentReady Outlook/);
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
assert.match(processingHtml, /Reviewing <strong>Your Answers\.\.\.<\/strong>/);
[
  'Income information reviewed',
  'Rental details reviewed',
  'Credit information reviewed',
  'Application factors reviewed',
  'Your RentReady Check <strong>Is Ready</strong>',
].forEach((text) => assert.ok(processingJs.includes(text), `${text} should be in the transition`));
// The transition only reflects the visitor's own answers.
const processingCopy = processingHtml + processingJs.replace(/^\s*\/\/.*$/gm, '');
assert.doesNotMatch(processingCopy, /credit report|screening report|landlord review|approved/i);

console.log('rentready checkout copy test passed');
