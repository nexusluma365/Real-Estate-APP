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
    'Your Second-Chance Matches Are Ready',
    'We found apartments based on your search and situation. Unlock your matches free for 7 days.',
    'Your Matches',
    'Based on the answers you gave us',
    'See property names, photos &amp; locations',
    'See second-chance information for each property',
    'See why each property may fit your situation',
    'Why RentReady?',
    "These aren't random apartment listings. RentReady researches property and management screening information before marking a listing as a second-chance option.",
    'Approval is always determined by the property.',
    '$0 Today',
    '7 days free',
    'Secure Checkout',
    'Your payment is securely processed.',
    'UNLOCK MY MATCHES',
    '$0 today • 7 days free • Cancel anytime',
    'After your 7-day free trial, RentReady is $19.99/month until canceled.',
    'Secure payment • Cancel anytime • No approval guarantee',
    'Your Search',
    'Your Answers',
    'Unlock Results',
    'This is not a rental application, landlord approval, or guarantee of approval.',
  ].forEach((text) => assert.ok(text.includes('<') ? html.includes(text) : visibleText.includes(text), `${text} should be present`));

  assert.doesNotMatch(html, /RentReady Outlook/);
  assert.doesNotMatch(html, /Questionnaire|Housing Plan|>Checkout</);
  assert.doesNotMatch(html, /One-time personalized review/);
  assert.doesNotMatch(html, /Better Your Approval odds/);
  assert.doesNotMatch(html, /View Listings/);
  assert.doesNotMatch(visibleText, /YOUR APARTMENT MATCHES ARE READY/);
  assert.doesNotMatch(visibleText, /Unlock the Apartment Matches You Just Previewed\./);
  assert.doesNotMatch(visibleText, /You already saw your matches/);
  assert.doesNotMatch(visibleText, /Second-chance options may be included when available\./);
  assert.doesNotMatch(visibleText, /RentReady Listing Membership — \$9\.99\/month/);
  assert.doesNotMatch(visibleText, /\$9\.99 monthly • Renews until canceled • No credit pull/);
  assert.doesNotMatch(visibleText, /START MY LISTING ACCESS/);
  assert.doesNotMatch(visibleText, /UNLOCK ACCESS/);
  assert.doesNotMatch(visibleText, /\$1 card verification/i);
  assert.doesNotMatch(visibleText, /ORDER SUMMARY/i);
  assert.doesNotMatch(visibleText, /Your RentReady Results/i);
  assert.doesNotMatch(visibleText, /RentReady Access Trial/i);
  assert.doesNotMatch(visibleText, /\$9\.99\/month/);
  assert.doesNotMatch(visibleText, /\$9\.99 billed monthly until canceled/);
  assert.doesNotMatch(visibleText, /7 DAYS FREE/);
  assert.doesNotMatch(visibleText, /Immediate access/);
  // The trial checkout stays single-purpose: no $47 kit promotion.
  assert.doesNotMatch(html, /\$47|Preparation Kit|real-estate-list/);
  // The payment form must come before the legal disclaimer in source order.
  assert.ok(html.indexOf('id="payBtn"') < html.indexOf('This is not a rental application'));
  assert.ok(html.indexOf('id="checkoutTitle"') < html.indexOf('class="includes"'), 'heading should come before benefits');
  assert.ok(html.indexOf('class="includes"') < html.indexOf('class="secure-badge"'), 'benefits should come before payment');
  assert.ok(html.indexOf('class="payment-form"') < html.indexOf('id="payBtn"'), 'payment fields should come before CTA');
  assert.ok(html.indexOf('id="checkoutMatchesMobile"') < html.indexOf('class="includes"'), 'mobile matches should appear before benefits');
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
  'Preparing your second-chance match preview...',
  'Your Second-Chance Matches <strong>Are Ready</strong>',
].forEach((text) => assert.ok(processingJs.includes(text), `${text} should be in the transition`));
// The transition only reflects the visitor's own answers.
const processingCopy = processingHtml + processingJs.replace(/^\s*\/\/.*$/gm, '');
assert.doesNotMatch(processingCopy, /credit report|screening report|landlord review|approved/i);

const previewHtml = fs.readFileSync(path.join(root, 'app/src/pages/RealEstateList/page.html'), 'utf8');
const previewScript = fs.readFileSync(path.join(root, 'app/src/pages/RealEstateList/script-0.js'), 'utf8');
const previewVisible = previewHtml.replace(/<[^>]+>/g, '');
assert.doesNotMatch(previewVisible, /UNLOCK FULL ACCESS/i, 'preview hero should not show an unlock access CTA');
assert.doesNotMatch(previewVisible, /\$9\.99|9\.99\/month|per month/i, 'preview page markup must not show pricing');
assert.ok(previewScript.includes('PREVIEW_VISIBLE_LIMIT = 8'), 'preview should show eight listing cards before checkout');
assert.ok(previewScript.includes('VIEW MORE'), 'preview should include a View More checkout CTA after visible listings');
assert.ok(previewScript.includes("We've Found ${PREVIEW_VISIBLE_LIMIT} Matches Based On Your Search Criteria"), 'preview hero should mention eight search-criteria matches');
assert.ok(previewScript.includes('7-day Free trial'), 'preview unlock buttons should show the 7-day free trial note');
assert.ok(previewScript.includes('Property details locked'), 'preview cards should lock property details');
assert.ok(previewScript.includes('Matched based on your search'), 'preview cards should explain the locked match basis');
assert.doesNotMatch(previewScript, /Availability locked/, 'preview cards should not show Availability locked text');

const checkoutCss = fs.readFileSync(path.join(root, 'app/src/pages/RentreadyReviewCheckout/page.css'), 'utf8');
const checkoutScript = fs.readFileSync(path.join(root, 'app/src/pages/RentreadyReviewCheckout/script-0.js'), 'utf8');
assert.match(checkoutCss, /\.includes-list li\{[^}]*display:flex;[^}]*align-items:flex-start;/, 'checkout benefits should align checks beside text');
assert.match(checkoutCss, /\.includes-list b\{[^}]*flex:0 0 22px;/, 'checkout check icon should keep fixed left column');
assert.match(checkoutScript, /PAY_BUTTON_LABEL = 'UNLOCK MY MATCHES'/, 'checkout error reset should keep the unlock CTA label');
assert.match(checkoutScript, /confirmCardSetup/, 'checkout should collect a card with a Stripe SetupIntent');
assert.doesNotMatch(checkoutScript, /confirmCardPayment/, 'checkout should not charge a PaymentIntent today');

console.log('rentready checkout copy test passed');
