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
    'YOUR APARTMENT MATCHES ARE READY',
    'Unlock the Apartment Matches You Just Previewed.',
    'You already saw your matches.',
    'Second-chance options may be included when available.',
    'Unlock Your Results',
    'See What May Help or Hurt Your Application',
    'Know What Property Managers May Look For',
    'Continue to Apartment Options Based on Your Search',
    'RentReady Listing Membership — $9.99/month',
    '$9.99 monthly • Renews until canceled • No credit pull',
    'Secure Checkout',
    'Your payment is securely processed.',
    'START MY LISTING ACCESS — $9.99/MONTH',
    '$9.99 billed monthly until canceled • Secure payment • Immediate access',
    'Your Search',
    'Your Answers',
    'Unlock Results',
    'This is not a rental application, landlord approval, or guarantee of approval.',
    'RentReady Listing Membership',
    '$9.99 billed monthly until canceled',
  ].forEach((text) => assert.ok(text.includes('<') ? html.includes(text) : visibleText.includes(text), `${text} should be present`));

  assert.doesNotMatch(html, /RentReady Outlook/);
  assert.doesNotMatch(html, /Questionnaire|Housing Plan|>Checkout</);
  assert.doesNotMatch(html, /One-time personalized review/);
  assert.doesNotMatch(html, /Better Your Approval odds/);
  assert.doesNotMatch(html, /View Listings/);
  // The $9.99 checkout stays single-purpose: no $47 kit promotion.
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
  'Your Apartment Matches <strong>Are Ready</strong>',
].forEach((text) => assert.ok(processingJs.includes(text), `${text} should be in the transition`));
// The transition only reflects the visitor's own answers.
const processingCopy = processingHtml + processingJs.replace(/^\s*\/\/.*$/gm, '');
assert.doesNotMatch(processingCopy, /credit report|screening report|landlord review|approved/i);

const previewHtml = fs.readFileSync(path.join(root, 'app/src/pages/RealEstateList/page.html'), 'utf8');
const previewScript = fs.readFileSync(path.join(root, 'app/src/pages/RealEstateList/script-0.js'), 'utf8');
const previewVisible = previewHtml.replace(/<[^>]+>/g, '');
assert.doesNotMatch(previewVisible, /UNLOCK FULL ACCESS/i, 'preview hero should not show an unlock access CTA');
assert.doesNotMatch(previewVisible, /\$9\.99|9\.99\/month|per month/i, 'preview page markup must not show pricing');
assert.ok(previewScript.includes('PREVIEW_VISIBLE_LIMIT = 5'), 'preview should show five listing cards before checkout CTA');
assert.ok(previewScript.includes('VIEW MORE'), 'preview should include a View More checkout CTA after visible listings');
assert.ok(previewScript.includes("We've Found"), 'preview hero should use concise found-matches copy');
assert.doesNotMatch(previewScript, /Availability locked/, 'preview cards should not show Availability locked text');

const checkoutCss = fs.readFileSync(path.join(root, 'app/src/pages/RentreadyReviewCheckout/page.css'), 'utf8');
assert.match(checkoutCss, /\.includes-list li\{[^}]*display:flex;[^}]*align-items:flex-start;/, 'checkout benefits should align checks beside text');
assert.match(checkoutCss, /\.includes-list b\{[^}]*flex:0 0 22px;/, 'checkout check icon should keep fixed left column');

console.log('rentready checkout copy test passed');
