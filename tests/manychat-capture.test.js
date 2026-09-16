const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'app/src/manychat.js'), 'utf8');

function storage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
  };
}

function runWithSearch(search, initialLocal = {}) {
  const sessionStorage = storage();
  const localStorage = storage(initialLocal);
  const context = {
    URLSearchParams,
    sessionStorage,
    localStorage,
    window: { location: { search } },
  };
  context.window.sessionStorage = sessionStorage;
  context.window.localStorage = localStorage;
  vm.createContext(context);
  vm.runInContext(script, context);
  return context;
}

{
  const context = runWithSearch('?lead_id=123456789');
  assert.equal(context.window.rrnManyChatContactId(), '123456789');
  assert.equal(context.sessionStorage.data.rrn_manychat_contact_id_v1, '123456789');
  assert.equal(context.localStorage.data.rrn_manychat_contact_id_v1, '123456789');
  assert.deepEqual(
    context.window.rrnAttachManyChatContactId({ lead_id: 'lead_123' }),
    { lead_id: 'lead_123', manychat_contact_id: '123456789' }
  );
}

{
  const context = runWithSearch('?lead_id=%3Cscript%3E', {
    rrn_manychat_contact_id_v1: '987654321',
  });
  assert.equal(context.window.rrnManyChatContactId(), '987654321');
  assert.deepEqual(
    context.window.rrnAttachManyChatContactId({ lead_id: 'lead_123' }),
    { lead_id: 'lead_123', manychat_contact_id: '987654321' }
  );
}

{
  const context = runWithSearch('/');
  assert.equal(context.window.rrnManyChatContactId(), '');
  assert.deepEqual(context.window.rrnAttachManyChatContactId({ lead_id: 'lead_123' }), { lead_id: 'lead_123' });
}

console.log('manychat capture test passed');
