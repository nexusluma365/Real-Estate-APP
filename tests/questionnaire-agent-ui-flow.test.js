const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class Store {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

class ClassList {
  constructor() {
    this.values = new Set();
  }
  add(name) {
    this.values.add(name);
  }
  remove(name) {
    this.values.delete(name);
  }
  toggle(name, force) {
    if (force) this.add(name);
    else this.remove(name);
  }
  contains(name) {
    return this.values.has(name);
  }
}

class Element {
  constructor(id, document, tagName = 'div') {
    this.id = id;
    this.document = document;
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.classList = new ClassList();
    this.style = {};
    this.value = '';
    this.disabled = false;
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.type = '';
    this._innerHTML = '';
    this._textContent = '';
  }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    if (this.id === 'agentResponseMount') this.document.unregisterDynamic();
    const inputMatch = this._innerHTML.match(/<input[^>]*id="agentInput"[^>]*>/);
    if (inputMatch) {
      const input = new Element('agentInput', this.document, 'input');
      input.value = (inputMatch[0].match(/value="([^"]*)"/) || [])[1] || '';
      input.type = (inputMatch[0].match(/type="([^"]*)"/) || [])[1] || 'text';
      input.checkValidity = () => input.type !== 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value);
      input.focus = () => {};
      this.document.registerDynamic(input);
      this.children.push(input);
    }
    for (const match of this._innerHTML.matchAll(/<button[^>]*class="([^"]*\bagent-option\b[^"]*)"[^>]*data-value="([^"]*)"[^>]*>(.*?)<\/button>/gs)) {
      const button = new Element('', this.document, 'button');
      button.classList.add('agent-option');
      if (match[1].includes('selected')) button.classList.add('selected');
      button.dataset.value = match[2];
      button.textContent = match[3].replace(/<[^>]+>/g, '').trim();
      this.children.push(button);
    }
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set textContent(value) {
    this._textContent = String(value);
  }
  get textContent() {
    return this._textContent;
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
  click() {
    if (this.listeners.click) this.listeners.click({ preventDefault() {} });
  }
  querySelectorAll(selector) {
    if (selector === '.agent-option') return this.children.filter((child) => child.classList.contains('agent-option'));
    return [];
  }
  focus() {}
}

class DocumentMock {
  constructor() {
    this.elements = new Map();
    this.dynamicIds = new Set();
    this.listeners = {};
    [
      'agentConversation',
      'agentResponseMount',
      'agentNext',
      'agentBack',
      'agentError',
      'agentProgress',
      'agentStepTag',
      'agentForm',
    ].forEach((id) => this.elements.set(id, new Element(id, this)));
    this.shell = new Element('', this);
  }
  getElementById(id) {
    return this.elements.get(id) || null;
  }
  querySelector(selector) {
    return selector === '[data-agent-number-one]' ? this.shell : null;
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
  registerDynamic(element) {
    this.elements.set(element.id, element);
    this.dynamicIds.add(element.id);
  }
  unregisterDynamic() {
    for (const id of this.dynamicIds) this.elements.delete(id);
    this.dynamicIds.clear();
  }
}

function createContext() {
  const document = new DocumentMock();
  const listeners = {};
  const storage = new Store();
  const context = {
    console,
    document,
    navigator: { userAgent: 'node-test' },
    crypto: { randomUUID: () => 'lead-test-123' },
    CustomEvent: function CustomEvent(type, init) {
      return { type, detail: init && init.detail };
    },
    Date,
    Math,
    Number,
    String,
    Set,
    Array,
    JSON,
    RegExp,
    sessionStorage: new Store(),
    localStorage: storage,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true }) }),
    setTimeout: () => 1,
    window: {
      location: { href: 'https://werentreadygo.com/questionnaire' },
      dataLayer: [],
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
      dispatchEvent() {},
    },
  };
  context.window.window = context.window;
  context.window.document = document;
  context.window.navigator = context.navigator;
  context.window.sessionStorage = context.sessionStorage;
  context.window.localStorage = context.localStorage;
  context.window.crypto = context.crypto;
  context.window.rrnAttachManyChatContactId = (payload) => ({ ...payload, manychat_contact_id: '123456789' });
  context.location = context.window.location;
  return { context, document, listeners };
}

function submit(document) {
  document.getElementById('agentForm').listeners.submit({ preventDefault() {} });
}

function answerInput(document, value) {
  document.getElementById('agentInput').value = value;
  submit(document);
}

function choose(document, value) {
  const button = document.getElementById('agentResponseMount').querySelectorAll('.agent-option')
    .find((option) => option.dataset.value === value);
  assert.ok(button, `expected option ${value}`);
  button.click();
  submit(document);
}

const root = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'app/src/pages/Questionnaire/script-0.js'), 'utf8');
const { context, document, listeners } = createContext();

vm.runInNewContext(script, context);
assert.equal(typeof document.listeners.DOMContentLoaded, 'function', 'questionnaire should initialize through document DOMContentLoaded for legacy React mounting');
document.listeners.DOMContentLoaded();

assert.equal(document.getElementById('agentConversation').innerHTML, '');
assert.equal(document.getElementById('agentStepTag').textContent, 'RentReady Assistant');
assert.match(document.getElementById('agentNext').innerHTML, /Start/);

submit(document);
submit(document);
assert.ok(document.shell.classList.contains('agent-started'));
assert.match(document.getElementById('agentConversation').innerHTML, /First, what should I call you\?/);
assert.equal(document.getElementById('agentError').textContent, '');

answerInput(document, 'Rae');
assert.match(document.getElementById('agentConversation').innerHTML, /And what is your last name\?/);

answerInput(document, 'Jordan');
answerInput(document, 'rae@example.com');
answerInput(document, '5551112222');
choose(document, 'sms');
answerInput(document, 'Austin, TX');
choose(document, '1_month');
choose(document, 'relocation');
answerInput(document, '90000');
answerInput(document, '2200');
choose(document, '660_699');
choose(document, '2');

assert.match(document.getElementById('agentConversation').innerHTML, /You are all set\./);
assert.doesNotMatch(document.getElementById('agentResponseMount').innerHTML, /Agent Status|Intent|sales-ready|agent_status/);

submit(document);

const answers = JSON.parse(context.localStorage.getItem('rrn_answers_v1'));
assert.equal(answers.agent_status, 'sales-ready');
assert.equal(answers.manychat_contact_id, '123456789');
assert.equal(answers.first_name, 'Rae');
assert.equal(answers.rent_budget, 2200);

const state = JSON.parse(context.localStorage.getItem('rrn_agent_number_one_v1'));
assert.equal(state.started, true);
assert.equal(state.lead_id, 'lead-test-123');
assert.equal(state.status, 'sales-ready');

const activityTypes = state.activity.map((event) => event.type);
[
  'agent_started',
  'question_presented',
  'answer_captured',
  'intent_classified',
  'handoff_ready',
  'lead_submitted',
].forEach((type) => {
  assert.ok(activityTypes.includes(type), `${type} should be emitted`);
});

console.log('questionnaire agent UI flow test passed');
