const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app/src/App.jsx'), 'utf8');
const homeHtml = fs.readFileSync(path.join(root, 'app/src/pages/Home/page.html'), 'utf8');
const homeScript = fs.readFileSync(path.join(root, 'app/src/pages/Home/script-0.js'), 'utf8');
const intentIndex = fs.readFileSync(path.join(root, 'app/src/pages/IntentLanding/index.jsx'), 'utf8');
const intents = fs.readFileSync(path.join(root, 'app/src/pages/IntentLanding/intents.js'), 'utf8');
const questionnaireScript = fs.readFileSync(path.join(root, 'app/src/pages/Questionnaire/script-0.js'), 'utf8');
const checkoutHtml = fs.readFileSync(path.join(root, 'app/src/pages/RentreadyReviewCheckout/page.html'), 'utf8');
const checkoutScript = fs.readFileSync(path.join(root, 'app/src/pages/RentreadyReviewCheckout/script-0.js'), 'utf8');

assert.match(app, /<Route path="\/" element={<Home \/>} \/>/);
assert.match(app, /<Route path="\/index\.html" element={<Home \/>} \/>/);
assert.match(app, /<Route path="\/check-my-rental-readiness" element={<Questionnaire \/>} \/>/);
assert.match(app, /<Route path="\/check-my-rental-readiness\/" element={<Questionnaire \/>} \/>/);
assert.doesNotMatch(app, /<Route path="\/" element={<Questionnaire \/>} \/>/);

[
  '/apartments-with-bad-credit',
  '/rent-after-eviction',
  '/rent-after-broken-lease',
  '/apartment-application-denied',
  '/apartment-income-requirements',
  '/first-apartment-no-credit',
  '/apartment-approval-requirements',
  '/second-chance-apartments',
].forEach((route) => assert.match(app, new RegExp(`<Route path="${route}" element={<IntentLanding`)));

[
  'SECOND-CHANCE APARTMENT SEARCH',
  'Looking for a Second-Chance Apartment?',
  'See where you stand before you apply — and find apartment options that may fit your situation.',
  'SEE WHERE I STAND',
  'No Credit Pull',
  'Takes Just a Few Minutes',
  'Based on What You Tell Us',
  'RentReady provides rental-readiness guidance. Final approval and rental requirements are determined by each property.',
].forEach((text) => assert.ok(homeHtml.includes(text), `${text} should be present on Home`));

[
  'Will I Get Approved?',
  'What Are You Worried About?',
  'Know Before You Apply.',
  "Don't Apply Blind.",
  'Ready to See Where You Stand?',
  'RentReady is not a landlord, property manager, rental application, or guarantee of approval.',
].forEach((text) => assert.ok(!homeHtml.includes(text), `${text} should be removed from Home`));

[
  'bad_credit',
  'eviction',
  'broken_lease',
  'denied_application',
  'income_requirements',
  'no_credit',
  'approval_requirements',
  'second_chance',
  'general_renter',
].forEach((intent) => {
  assert.ok(intents.includes(intent), `${intent} should be configured`);
  assert.ok(questionnaireScript.includes(intent), `${intent} should be valid in questionnaire`);
  assert.ok(checkoutScript.includes(intent), `${intent} should be valid in checkout`);
});

[
  'Renting With Bad Credit? Check Your Rental Readiness | RentReady',
  'Renting After an Eviction? See What to Check First | RentReady',
  'Renting After a Broken Lease? Check Your Next Step | RentReady',
  'Apartment Application Denied? Know What to Do Next | RentReady',
  'Do You Make Enough to Rent the Apartment? | RentReady',
  'First Apartment With Little or No Credit? Start Here | RentReady',
  'Wondering About Apartment Approval? Check First | RentReady',
  'Looking for Second Chance Apartments? Start With Your Rental Situation | RentReady',
].forEach((title) => assert.ok(intents.includes(title), `${title} SEO title should be configured`));

assert.match(intentIndex, /setCanonical\(page\.route\)/);
assert.match(intentIndex, /href={CHECK_URL}/);
assert.match(intentIndex, /writeIntent\(intentKey\)/);
assert.match(homeScript, /rrn_entry_intent_v1/);
assert.match(questionnaireScript, /entry_intent: ensureEntryIntent\(\)/);
assert.doesNotMatch(checkoutHtml, /id="checkoutIntentContext"/);
assert.match(checkoutHtml, /<h1>Start Your Free 7-Day Trial<\/h1>/);
assert.match(checkoutHtml, /Unlock your second-chance apartment matches and see the places that may fit your situation\./);
assert.match(checkoutScript, /bad_credit: 'Second-chance options may be included when available\.'/);
assert.match(checkoutScript, /general_renter: 'Second-chance options may be included when available\.'/);

[
  'intent_landing_view',
  'intent_cta_click',
  'questionnaire_started',
  'questionnaire_completed',
  'checkout_viewed',
  'review_purchased',
  'results_viewed',
].forEach((eventName) => {
  const all = [homeScript, intentIndex, questionnaireScript, checkoutScript, fs.readFileSync(path.join(root, 'app/src/pages/AfterPaymentResults/script-0.js'), 'utf8')].join('\n');
  assert.ok(all.includes(eventName), `${eventName} should be tracked`);
});

[
  'credit_score',
  'annual_income',
  'rental_debt',
  'phone',
  'email',
].forEach((sensitive) => {
  assert.doesNotMatch(intentIndex, new RegExp(`rrTrack\\([^\\n]+${sensitive}`));
  assert.doesNotMatch(checkoutScript, new RegExp(`rrTrack\\([^\\n]+${sensitive}`));
});

console.log('home and intent routes test passed');
