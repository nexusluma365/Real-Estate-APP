const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/src/pages/Questionnaire/page.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/src/pages/Questionnaire/page.css'), 'utf8');
const js = fs.readFileSync(path.join(root, 'app/src/pages/Questionnaire/script-0.js'), 'utf8');

[
  'first_name',
  'last_name',
  'email',
  'phone',
  'preferred_city',
  'annual_income',
  'rent_budget',
  'current_rent',
].forEach((id) => {
  const line = html.split('\n').find((item) => item.includes(`id="${id}"`)) || '';
  assert.ok(line.includes('required'), `${id} should be required`);
});

[
  "validateAndNext(3,['email','phone'],['contact_method_pills'])",
  "validateAndNext(4,['preferred_city'],['move_timeline_pills'])",
  
  "validateAndNext(6,['annual_income','rent_budget'])",
  "validateAndNext(7,[],['credit_score_pills'])",
  "validateAndNext(8,[],['beds_needed_pills'])",
].forEach((call) => {
  assert.ok(html.includes(call), `${call} should guard the step transition`);
});

assert.doesNotMatch(html, /id="date_of_birth"/);
assert.match(css, /\.field-group\.c2 \.birthdate-field/);
assert.match(css, /justify-self: center/);
assert.match(css, /\.centered-date \{ text-align: center; \}/);
assert.match(css, /\.pills\.invalid \.pill/);
assert.match(css, /\.slide \{[^}]*text-align: center/s);
assert.match(css, /\.slide\.active \{ display: grid; align-content: center; \}/);
assert.match(css, /\.card \{[^}]*max-width: 780px/s);
assert.match(css, /\.field-group \{[^}]*max-width: 540px; margin: 0 auto 26px; text-align: left/s);
assert.match(css, /\.btn-row \{[^}]*max-width: 540px; margin: 0 auto/s);
assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.shell \{ display: block; padding: 18px; \}/);
assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.card \{ width: 100%; max-width: 100%;[^}]*border-radius: 30px/s);
assert.match(css, /@media \(max-width: 620px\) \{[\s\S]*\.btn-row \{ flex-direction: column-reverse; \}/);
assert.match(css, /@media \(max-width: 620px\) \{[\s\S]*\.card \{ width: min\(100%, calc\(100vw - 24px\)\); max-width: none; \}/);
assert.doesNotMatch(css, /max-width: 300px/);
assert.ok(html.includes('Find apartments that fit your <strong>next move.</strong>'), 'intro should continue the apartment-search intent');
assert.ok(/data-val="1_month"[\s\S]*1 Month<\/div>/.test(html), 'timeline option should be brief');
assert.ok(/data-val="phone"[\s\S]*Call<\/div>/.test(html), 'contact option should be brief');
assert.doesNotMatch(html, /data-val="whatsapp"/);
assert.doesNotMatch(html, /WhatsApp/);
assert.ok(/data-val="upsizing"[\s\S]*More Space<\/div>/.test(html), 'move reason option should be brief');
assert.ok(/data-val="1"[\s\S]*1 Bed<\/div>/.test(html), 'bedroom option should be brief');
assert.doesNotMatch(html, /data-val="800_plus"/);
assert.doesNotMatch(html, /800\+/);
assert.doesNotMatch(html, /Exceptional/);

assert.match(js, /function validateFields\(fields = \[\], pillGroups = \[\]\)/);
assert.match(js, /date_of_birth:\s+''/);
assert.match(js, /function validateEntireQuestionnaire\(\)/);
assert.match(js, /if \(!validateEntireQuestionnaire\(\)\) return;/);

console.log('questionnaire required fields test passed');
