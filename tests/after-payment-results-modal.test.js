const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/src/pages/AfterPaymentResults/page.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/src/pages/AfterPaymentResults/page.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app/src/pages/AfterPaymentResults/script-0.js'), 'utf8');

[
  'Reviewing income fit',
  'Reviewing rental profile',
  'Checking deposit factors',
  'Comparing your answers',
  'Preparing your RentReady outlook',
  'YOUR RESULTS ARE READY',
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
  'matchingApartmentsCta',
].forEach(id => assert.match(html, new RegExp(`id="${id}"`)));

assert.match(html, /YOUR DEPOSIT OUTLOOK/i);
assert.match(html, /SEE MY MATCHING APARTMENTS/);
assert.match(html, /Final approval and deposit requirements are determined by each property/);

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
assert.match(js, /\/real-estate-list\.html\?/);
assert.match(js, /STRONG OUTLOOK/);
assert.match(js, /WORTH EXPLORING/);
assert.match(js, /MIXED OUTLOOK/);
assert.match(js, /DEPOSIT LIKELY/);
assert.match(js, /MORE PREPARATION RECOMMENDED/);
assert.doesNotMatch(js, /Guaranteed approval|Guaranteed no deposit|You qualify|You are approved/);

console.log('after-payment results modal test passed');
