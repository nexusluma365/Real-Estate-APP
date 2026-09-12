const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/src/pages/AfterPaymentResults/page.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/src/pages/AfterPaymentResults/page.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app/src/pages/AfterPaymentResults/script-0.js'), 'utf8');

[
  'Reviewing income and rent fit',
  'Reviewing rental profile',
  'Reviewing credit-related factors',
  'Reviewing previous housing information',
  'Comparing deposit qualification factors',
  'Preparing your pre-qualification result',
  'PRE-QUALIFICATION COMPLETE',
].forEach(text => assert.match(html, new RegExp(text)));

[
  'analysisOverlay',
  'analysisModal',
  'analysisClose',
  'outlookMini',
  'modalOutlookTitle',
  'modalScoreValue',
  'depositMeterFill',
  'outlookBars',
  'factorBreakdown',
  'helpedList',
  'concernList',
  'bestNextMoves',
  'ratingLegend',
  'matchingApartmentsCta',
].forEach(id => assert.match(html, new RegExp(`id="${id}"`)));

assert.match(html, /RENTREADY PRE-QUALIFICATION RESULT/i);
assert.match(html, /WHAT YOUR RATING MEANS/i);
assert.match(html, /Your RentReady review is complete/i);
assert.match(html, /Your Pre-Qualification Results Are Ready\./);
assert.match(html, /View Your Pre-Qualification ↓/);
assert.match(html, /SEE MY MATCHING APARTMENTS/);
assert.match(html, /It is not a property approval/);
assert.match(html, /YOUR NEXT STEP/);
assert.match(html, /Now, Let’s Find Apartments That Match Your Search\./);
assert.match(html, /Choose the type of apartment you want to explore, and RentReady will use your preferences to show matching options in your selected area\./);
assert.match(html, /Your RentReady pre-qualification is complete — now choose where you want to continue\./);
assert.match(html, /Upscale communities with premium finishes, amenities, and locations\./);
assert.match(html, /EXPLORE LUXURY APARTMENTS →/);
assert.match(html, /Updated communities with modern features, comfort, and everyday convenience\./);
assert.match(html, /EXPLORE MODERN APARTMENTS →/);
assert.match(html, /Your RentReady pre-qualification stays with you as you continue your search\./);
assert.match(html, /BEFORE WE SHOW YOUR MATCHES/);
assert.match(html, /Know What Could Matter Before You Apply\./);
assert.match(html, /You already know where your profile stands\. Now go one step further and see what could affect your application before you tour, call a leasing office, or spend money on an application fee\./);
assert.match(html, /See What Could Affect Approval/);
assert.match(html, /Know which parts of your profile may get a closer look\./);
assert.match(html, /Know What to Have Ready/);
assert.match(html, /See which documents and details a leasing office may ask for\./);
assert.match(html, /Know What to Ask Before Applying/);
assert.match(html, /Get simple questions you can use to understand a property's requirements\./);
assert.match(html, /Compare Your Profile to Property Requirements/);
assert.match(html, /Know what to confirm when reviewing the apartments you want\./);
assert.match(html, /<section class="bottom-disclosure" aria-label="RentReady disclaimer">/);
assert.match(html, /RentReady provides educational rental-readiness guidance based on the information you provide\. Deposit requirements, screening standards, and approval decisions vary by property\. RentReady does not guarantee approval or a security-deposit waiver\./);

assert.match(css, /\.analysis-overlay/);
assert.match(css, /\.analysis-overlay\.is-closing \.analysis-modal/);
assert.match(css, /--modal-dx/);
assert.match(css, /\.outlook:hover/);
assert.match(css, /\.apartment-card:hover/);
assert.match(css, /transform:translateY\(-4px\)/);
assert.match(css, /\.apartment-card-cta/);
assert.match(css, /\.bottom-disclosure/);
assert.match(css, /@media \(max-width: 520px\)/);

assert.match(js, /analysisState = \{/);
assert.match(js, /analysisLoading/);
assert.match(js, /analysisComplete/);
assert.match(js, /reportOpen/);
assert.match(js, /reportMinimized/);
assert.match(js, /function normalizeProfile/);
assert.match(js, /function runAnalysisSequence/);
assert.match(js, /function openAnalysisModal/);
assert.match(js, /function closeAnalysisModal/);
assert.match(js, /function setModalTransformVars/);
assert.match(js, /function renderRatingLegend/);
assert.match(html, /href="#briefResult" data-target="briefResult"/);
assert.match(js, /closeAnalysisModal\(\)/);
assert.match(js, /HIGHLY FAVORABLE/);
assert.match(js, /FAVORABLE/);
assert.match(js, /PROMISING/);
assert.match(js, /CONDITIONAL/);
assert.match(js, /HIGHER DEPOSIT LIKELY/);
assert.doesNotMatch(html + js, /Worth Exploring|Strong Outlook|Good Chance|Good Outlook|YOUR RESULTS ARE READY/);
assert.doesNotMatch(html, /The part most renters miss|A better result comes|Your application risk check|Your document-ready list|Exact questions to ask|Property-by-property comparison|Your next RentReady step|Turn this result into your personal rental strategy|See My Personalized Next Steps|Continue Browsing Homes|ONE MORE STEP BEFORE YOUR MATCHES|GET MY PERSONALIZED GAME PLAN|skipToSelectedApartments|offer-card/);
assert.doesNotMatch(js, /selectedApartmentCategory|updateSelectedApartmentCta|skipToSelectedApartments/);
assert.doesNotMatch(js, /Guaranteed approval|Guaranteed no deposit|You qualify|You are approved/);

console.log('after-payment results modal test passed');
