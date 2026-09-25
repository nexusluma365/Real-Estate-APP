const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/src/pages/AfterPaymentResults/page.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/src/pages/AfterPaymentResults/page.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app/src/pages/AfterPaymentResults/script-0.js'), 'utf8');

[
  'Reviewing income and rent fit',
  'Reviewing the details you shared',
  'Reviewing credit-related factors',
  'Organizing the information you shared',
  'Comparing common rental screening factors',
  'Preparing your personalized rental outlook',
  'YOUR RENTREADY OUTLOOK IS READY',
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

assert.match(html, /YOUR RENTAL READINESS OUTLOOK/i);
assert.match(html, /WHAT YOUR RATING MEANS/i);
assert.match(html, /YOUR RENTREADY CHECK IS COMPLETE/i);
const confirmationEmailMessage = 'We’ve also sent a confirmation email to the email address you provided. If you don’t see it in your inbox, please check your spam or junk folder.';
assert.equal((html.match(new RegExp(confirmationEmailMessage, 'g')) || []).length, 2);
assert.match(html, /id="modalOutlookCopy"[\s\S]*?<p class="results-email-note">We’ve also sent a confirmation email/);
assert.match(html, /id="outlookCopy"[\s\S]*?<p class="outlook-email-note">We’ve also sent a confirmation email/);
assert.match(html, /Here's Where You Stand\./);
assert.match(html, /View Your Rental Outlook ↓/);
assert.match(html, /CONTINUE TO APARTMENT OPTIONS/);
assert.match(html, /It is not a property approval or credit decision/);
assert.match(html, /YOUR NEXT STEP/);
assert.match(html, /Before You Apply Again, Prepare Your Rental Profile\./);
assert.match(html, /Your RentReady Review showed you where you currently stand\./);
assert.match(html, /No need to start over — your search details move forward with you\./);
assert.match(html, /PREPARE FOR MY NEXT APPLICATION →/);
assert.match(html, /No thanks — continue to apartment listings/);
assert.match(html, /Your RentReady review stays with you as you continue your apartment search\./);
assert.match(html, /YOU'RE READY FOR THE NEXT STEP/);
assert.match(html, /Keep Your Search Moving With Better Information\./);
assert.match(html, /You now know where your profile stands\. When you continue to an apartment list/);
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
assert.match(css, /\.outlook-email-note/);
assert.match(css, /\.analysis-summary \.results-email-note/);
assert.match(css, /\.apartment-primary-cta:hover/);
assert.match(css, /transform:translateY\(-4px\)/);
assert.match(css, /\.apartment-secondary-link/);
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
assert.match(js, /function configureApartmentNextStepLinks/);
assert.match(js, /\/apartment-approval-preparation-kit/);
assert.match(js, /upsell-skipped/);
assert.match(html, /href="#briefResult" data-target="briefResult"/);
assert.match(js, /closeAnalysisModal\(\)/);
assert.match(js, /HIGHLY FAVORABLE/);
assert.match(js, /FAVORABLE/);
assert.match(js, /PROMISING/);
assert.match(js, /CONDITIONAL/);
assert.match(js, /HIGHER DEPOSIT LIKELY/);
assert.doesNotMatch(html + js, /Worth Exploring|Strong Outlook|Good Chance|Good Outlook|YOUR RESULTS ARE READY/);
assert.doesNotMatch(html, /CONTINUE TO LUXURY APARTMENTS|CONTINUE TO MODERN APARTMENTS|luxury-apartments-premium|modern-apartments-premium/);
assert.doesNotMatch(html, /The part most renters miss|A better result comes|Your application risk check|Your document-ready list|Exact questions to ask|Property-by-property comparison|Your next RentReady step|Turn this result into your personal rental strategy|See My Personalized Next Steps|Continue Browsing Homes|ONE MORE STEP BEFORE YOUR MATCHES|GET MY PERSONALIZED GAME PLAN|skipToSelectedApartments|offer-card/);
assert.doesNotMatch(js, /selectedApartmentCategory|updateSelectedApartmentCta|skipToSelectedApartments/);
assert.doesNotMatch(js, /Guaranteed approval|Guaranteed no deposit|You qualify|You are approved/);

console.log('after-payment results modal test passed');
