const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const questionnaireScript = fs.readFileSync(path.join(root, 'app/src/pages/Questionnaire/script-0.js'), 'utf8');
const processingScript = fs.readFileSync(path.join(root, 'app/src/pages/ResultsProcessing/script-0.js'), 'utf8');
const checkoutScript = fs.readFileSync(path.join(root, 'app/src/pages/RentreadyReviewCheckout/script-0.js'), 'utf8');

class Store {
  constructor(values) {
    this.values = new Map(Object.entries(values || {}));
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
    if (force === undefined ? !this.values.has(name) : !!force) this.add(name);
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
    this.type = '';
    this.className = '';
    this._innerHTML = '';
    this._textContent = '';
  }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
    if (this.id === 'agentResponseMount' && this.document.unregisterDynamic) this.document.unregisterDynamic();
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
  appendChild(child) {
    this.children.push(child);
    if (child.id) this.document.elements.set(child.id, child);
    return child;
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
  constructor(ids) {
    this.elements = new Map();
    this.dynamicIds = new Set();
    this.listeners = {};
    ids.forEach((id) => this.elements.set(id, new Element(id, this)));
    this.shell = new Element('', this);
  }
  getElementById(id) {
    return this.elements.get(id) || null;
  }
  querySelector(selector) {
    return selector === '[data-agent-number-one]' ? this.shell : null;
  }
  createElement(tagName) {
    return new Element('', this, tagName);
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

async function submit(document) {
  await document.getElementById('agentForm').listeners.submit({ preventDefault() {} });
}

async function answerInput(document, value) {
  document.getElementById('agentInput').value = value;
  await submit(document);
}

async function choose(document, value) {
  const button = document.getElementById('agentResponseMount').querySelectorAll('.agent-option')
    .find((option) => option.dataset.value === value);
  assert.ok(button, `expected option ${value}`);
  button.click();
  await submit(document);
}

async function runQuestionnaire(sessionStorage, localStorage, requests) {
  const document = new DocumentMock([
    'agentConversation',
    'agentResponseMount',
    'agentNext',
    'agentBack',
    'agentError',
    'agentProgress',
    'agentStepTag',
    'agentForm',
  ]);
  const context = {
    console,
    document,
    navigator: { userAgent: 'questionnaire-to-checkout-test' },
    crypto: { randomUUID: () => 'lead-full-flow-123' },
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
    Promise,
    RegExp,
    sessionStorage,
    localStorage,
    fetch: async (url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      requests.push({ stage: 'questionnaire', url, body });
      if (body.lookupOnly) return { ok: true, json: async () => ({ ok: true, registered: false }) };
      return { ok: true, json: async () => ({ ok: true, saved: true, agentHandoff: { ok: true, mode: 'forwarded' } }) };
    },
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    window: {
      location: { href: 'https://werentreadygo.com/questionnaire' },
      dataLayer: [],
      addEventListener() {},
      dispatchEvent() {},
    },
  };
  context.window.window = context.window;
  context.window.document = document;
  context.window.navigator = context.navigator;
  context.window.sessionStorage = sessionStorage;
  context.window.localStorage = localStorage;
  context.window.crypto = context.crypto;
  context.location = context.window.location;

  vm.runInNewContext(questionnaireScript, context);
  document.listeners.DOMContentLoaded();

  await submit(document);
  await answerInput(document, 'Rae');
  await answerInput(document, 'Jordan');
  await answerInput(document, 'rae@example.com');
  await answerInput(document, '5551112222');
  await choose(document, 'sms');
  await answerInput(document, 'Austin, TX');
  await choose(document, '1_month');
  await choose(document, 'relocation');
  await answerInput(document, '90000');
  await answerInput(document, '2200');
  await choose(document, '660_699');
  await choose(document, '2');
  await submit(document);

  assert.equal(context.window.location.href, '/results-processing.html');
  const answers = JSON.parse(sessionStorage.getItem('rrn_answers_v1'));
  assert.equal(answers.lead_id, 'lead-full-flow-123');
  assert.equal(answers.agent_status, 'sales-ready');
  assert.ok(requests.some((request) => request.url === '/.netlify/functions/submit-lead'));
}

function runResultsProcessing(sessionStorage, localStorage) {
  const document = new DocumentMock(['checklist', 'progFill', 'statusLine']);
  const context = {
    console,
    document,
    sessionStorage,
    localStorage,
    JSON,
    Date,
    Math,
    setTimeout: (fn) => {
      fn();
      return 1;
    },
    window: {
      location: { href: '/results-processing.html' },
    },
  };
  context.window.sessionStorage = sessionStorage;
  context.window.localStorage = localStorage;

  vm.runInNewContext(processingScript, context);
  assert.equal(context.window.location.href, '/rentready-review-checkout');
  assert.equal(JSON.parse(sessionStorage.getItem('rrn_flow_access_v1')).step, 'prescreen-checkout');
}

async function runCheckout(sessionStorage, localStorage, requests) {
  const document = new DocumentMock([
    'paymentError',
    'setupNote',
    'summaryName',
    'summaryCity',
    'summaryMove',
    'summaryCredit',
    'payBtn',
    'cardNumber',
    'cardExpiry',
    'cardCvc',
    'billingZip',
  ]);
  document.getElementById('payBtn').disabled = true;
  const mounted = [];
  const context = {
    console,
    document,
    sessionStorage,
    localStorage,
    Stripe(key) {
      assert.match(key, /^pk_(test|live)_/);
      return {
        elements() {
          return {
            create(type) {
              return {
                focus() {},
                mount(selector) {
                  mounted.push({ type, selector });
                },
                on() {},
              };
            },
          };
        },
        async confirmCardPayment(clientSecret, options) {
          assert.equal(clientSecret, 'pi_full_flow_secret');
          assert.equal(options.payment_method.billing_details.name, 'Rae Jordan');
          assert.equal(options.payment_method.billing_details.email, 'rae@example.com');
          assert.equal(options.payment_method.billing_details.address.postal_code, '12345');
          return { paymentIntent: { id: 'pi_full_flow', status: 'succeeded' } };
        },
      };
    },
    fetch: async (url, options = {}) => {
      requests.push({ stage: 'checkout', url, body: options.body ? JSON.parse(options.body) : null });
      if (String(url).includes('get-entitlements')) {
        return { ok: true, json: async () => ({ ok: true, paid10: false }) };
      }
      if (String(url).includes('config')) {
        return { ok: true, json: async () => ({ ok: true, stripePublishableKey: 'pk_test_full_flow' }) };
      }
      if (String(url).includes('create-payment-intent')) {
        return {
          ok: true,
          json: async () => ({ ok: true, clientSecret: 'pi_full_flow_secret', paymentIntentId: 'pi_full_flow' }),
        };
      }
      if (String(url).includes('confirm-intent')) {
        return { ok: true, json: async () => ({ ok: true, status: 'succeeded' }) };
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    window: {
      location: {
        href: '/rentready-review-checkout',
        replace(url) {
          this.href = url;
        },
      },
    },
  };
  context.window.Stripe = context.Stripe;
  context.window.sessionStorage = sessionStorage;
  context.window.localStorage = localStorage;

  vm.createContext(context);
  vm.runInContext(checkoutScript, context);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(mounted.map((entry) => entry.type), ['cardNumber', 'cardExpiry', 'cardCvc']);
  assert.equal(document.getElementById('summaryName').textContent, 'Rae Jordan');
  assert.equal(document.getElementById('summaryCity').textContent, 'Austin, TX');

  document.getElementById('billingZip').value = '12345';
  await document.getElementById('payBtn').listeners.click();

  assert.equal(JSON.parse(sessionStorage.getItem('rrn_flow_access_v1')).step, 'prescreen-results');
  assert.equal(sessionStorage.getItem('rrn_prescreen_payment_intent_v1'), 'pi_full_flow');
  assert.equal(context.window.location.href, '/after-payment-results/');
}

async function run() {
  const sessionStorage = new Store();
  const localStorage = new Store();
  const requests = [];

  await runQuestionnaire(sessionStorage, localStorage, requests);
  runResultsProcessing(sessionStorage, localStorage);
  await runCheckout(sessionStorage, localStorage, requests);

  assert.ok(requests.some((request) => request.stage === 'checkout' && String(request.url).includes('create-payment-intent')));
  assert.ok(requests.some((request) => request.stage === 'checkout' && String(request.url).includes('confirm-intent')));
}

run()
  .then(() => console.log('questionnaire to checkout flow test passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
