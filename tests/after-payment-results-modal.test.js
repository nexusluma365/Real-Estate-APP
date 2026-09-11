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
assert.match(html, /SEE MY MATCHING APARTMENTS/);
assert.match(html, /It is not a property approval/);

assert.match(css, /\.analysis-overlay/);
assert.match(css, /\.analysis-overlay\.is-closing \.analysis-modal/);
assert.match(css, /--modal-dx/);
assert.match(css, /\.outlook:hover/);
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
assert.match(js, /\/real-estate-list\.html\?/);
assert.match(js, /HIGHLY FAVORABLE/);
assert.match(js, /FAVORABLE/);
assert.match(js, /PROMISING/);
assert.match(js, /CONDITIONAL/);
assert.match(js, /HIGHER DEPOSIT LIKELY/);
assert.doesNotMatch(html + js, /Worth Exploring|Strong Outlook|Good Chance|Good Outlook|YOUR RESULTS ARE READY/);
assert.doesNotMatch(js, /Guaranteed approval|Guaranteed no deposit|You qualify|You are approved/);

console.log('after-payment results modal test passed');
