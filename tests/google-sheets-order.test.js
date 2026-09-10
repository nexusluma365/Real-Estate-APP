const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'google-apps-script', 'code.gs'), 'utf8');

function extractArray(name) {
  const match = code.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(match, `${name} array should exist`);
  return vm.runInNewContext(`[${match[1]}]`);
}

function extractRowPayloadOrder() {
  const match = code.match(/const row = \[([\s\S]*?)\];/);
  assert.ok(match, 'writeLead_ row array should exist');
  const fields = [];
  const fieldPattern = /payload\.([a-z_]+)\s*\|\|\s*""/g;
  let fieldMatch;
  while ((fieldMatch = fieldPattern.exec(match[1])) !== null) {
    fields.push(fieldMatch[1]);
  }
  return ['received_at', 'lead_id', ...fields];
}

const expectedOrder = [
  'received_at',
  'lead_id',
  'submitted_at',
  'first_name',
  'last_name',
  'email',
  'date_of_birth',
  'move_timeline',
  'preferred_city',
  'move_reason',
  'annual_income',
  'credit_score',
  'beds_needed',
  'rent_budget',
  'current_rent',
  'contact_method',
  'phone',
  'source_page',
  'referrer',
  'user_agent',
];

assert.deepEqual(extractArray('HEADERS'), expectedOrder);
assert.deepEqual(extractRowPayloadOrder(), expectedOrder);

console.log('google sheets order test passed');
