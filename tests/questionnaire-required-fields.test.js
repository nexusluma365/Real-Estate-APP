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
  'date_of_birth',
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
  "validateAndNext(5,[],['move_reason_pills'])",
  "validateAndNext(6,['annual_income','rent_budget','current_rent'])",
  "validateAndNext(7,[],['credit_score_pills'])",
  "validateAndNext(8,[],['beds_needed_pills'])",
].forEach((call) => {
  assert.ok(html.includes(call), `${call} should guard the step transition`);
});

assert.match(html, /class="field birthdate-field"/);
assert.match(html, /id="date_of_birth" class="centered-date" required/);
assert.match(css, /\.field-group\.c2 \.birthdate-field/);
assert.match(css, /justify-self: center/);
assert.match(css, /\.centered-date \{ text-align: center; \}/);
assert.match(css, /\.pills\.invalid \.pill/);
assert.match(css, /\.slide \{[^}]*text-align: center/s);
assert.match(css, /\.slide\.active \{ display: grid; align-content: center; \}/);
assert.match(css, /\.field-group \{[^}]*max-width: 760px; margin: 0 auto 32px; text-align: left/s);
assert.match(css, /\.btn-row \{[^}]*max-width: 760px; margin: 0 auto/s);
assert.match(css, /@media \(max-width: 768px\) \{[\s\S]*\.card \{ border-radius: 0; border: none; min-height: 100dvh; box-shadow: none; \}/);
assert.match(css, /@media \(max-width: 620px\) \{[\s\S]*\.btn-row \{ flex-direction: column-reverse; \}/);

assert.match(js, /function todayMinusYears\(years\)/);
assert.match(js, /function isAtLeast17\(dateValue\)/);
assert.match(js, /todayMinusYears\(17\)/);
assert.match(js, /birthdate\.max = todayMinusYears\(17\)/);
assert.match(js, /You must be at least 17 years old to continue\./);
assert.match(js, /function validateFields\(fields = \[\], pillGroups = \[\]\)/);
assert.match(js, /function validateEntireQuestionnaire\(\)/);
assert.match(js, /if \(!validateEntireQuestionnaire\(\)\) return;/);

console.log('questionnaire required fields test passed');
