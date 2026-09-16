function rrTrack(eventName, detail = {}) {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: eventName, ...detail });
    window.dispatchEvent(new CustomEvent('rentready:event', { detail: { event: eventName, ...detail } }));
  } catch (_) {}
}

const GOOGLE_SCRIPT_URL = '/.netlify/functions/submit-lead';
const LEAD_QUEUE_KEY = 'rrn_leads_v2';
const ANSWERS_STORAGE_KEY = 'rrn_answers_v1';
const AGENT_STATE_KEY = 'rrn_agent_number_one_v1';
const POST_SUBMIT_REDIRECT_URL = '/results-processing.html';
const POST_SUBMIT_REDIRECT_DELAY_MS = 900;

const QUESTIONS = [
  {
    id: 'welcome',
    field: null,
    prompt: 'I am Agent Number One, your RentReady Qualification Concierge. Ready to begin?',
    helper: 'I will collect the basics, classify your intent, and prepare your handoff. I do not make approval decisions or guarantees.',
    type: 'start',
    nextLabel: 'Start My Qualification',
  },
  {
    id: 'first_name',
    field: 'first_name',
    prompt: 'What is your first name?',
    type: 'text',
    autocomplete: 'given-name',
    placeholder: 'Jane',
    required: true,
  },
  {
    id: 'last_name',
    field: 'last_name',
    prompt: 'Thanks. What is your last name?',
    type: 'text',
    autocomplete: 'family-name',
    placeholder: 'Smith',
    required: true,
  },
  {
    id: 'email',
    field: 'email',
    prompt: 'Where should RentReady send your review?',
    helper: 'Use the email address you want tied to your RentReady progress.',
    type: 'email',
    autocomplete: 'email',
    placeholder: 'jane@example.com',
    required: true,
  },
  {
    id: 'phone',
    field: 'phone',
    prompt: 'What phone number should we keep on file?',
    type: 'tel',
    autocomplete: 'tel',
    placeholder: '+1 (555) 000-0000',
    required: true,
  },
  {
    id: 'contact_method',
    field: 'contact_method',
    prompt: 'How should RentReady contact you?',
    type: 'choice',
    required: true,
    options: [
      { value: 'email', label: 'Email' },
      { value: 'phone', label: 'Call' },
      { value: 'sms', label: 'Text' },
    ],
  },
  {
    id: 'preferred_city',
    field: 'preferred_city',
    prompt: 'What city or area are you hoping to move to?',
    type: 'text',
    placeholder: 'Austin, TX',
    required: true,
  },
  {
    id: 'move_timeline',
    field: 'move_timeline',
    prompt: 'When are you planning to move?',
    type: 'choice',
    required: true,
    options: [
      { value: 'asap', label: 'ASAP' },
      { value: '1_month', label: '1 Month' },
      { value: '3_months', label: '1-3 Months' },
      { value: '6_months', label: '3-6 Months' },
      { value: 'flexible', label: 'Flexible' },
    ],
  },
  {
    id: 'move_reason',
    field: 'move_reason',
    prompt: 'What best describes your next move?',
    helper: 'Choose the closest fit. This helps route the handoff context, not eligibility.',
    type: 'choice',
    required: false,
    options: [
      { value: 'new_job', label: 'New Job' },
      { value: 'lifestyle', label: 'Upgrade' },
      { value: 'family', label: 'Family' },
      { value: 'school', label: 'School' },
      { value: 'downsizing', label: 'Downsizing' },
      { value: 'upsizing', label: 'More Space' },
      { value: 'relocation', label: 'Relocation' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    id: 'annual_income',
    field: 'annual_income',
    prompt: 'What is your estimated annual household income?',
    type: 'range',
    min: 20000,
    max: 500000,
    step: 5000,
    defaultValue: 75000,
    required: true,
    prefix: '$',
  },
  {
    id: 'rent_budget',
    field: 'rent_budget',
    prompt: 'What monthly rent budget feels realistic?',
    type: 'range',
    min: 500,
    max: 15000,
    step: 100,
    defaultValue: 2000,
    required: true,
    prefix: '$',
    suffix: '/mo',
  },
  {
    id: 'credit_score',
    field: 'credit_score',
    prompt: 'About where is your credit score?',
    helper: 'An estimate is fine. RentReady does not pull your credit.',
    type: 'choice',
    required: true,
    options: [
      { value: 'below_580', label: 'Under 580' },
      { value: '580_619', label: '580-619' },
      { value: '620_659', label: '620-659' },
      { value: '660_699', label: '660-699' },
      { value: '700_739', label: '700-739' },
      { value: '740_799', label: '740-799' },
    ],
  },
  {
    id: 'beds_needed',
    field: 'beds_needed',
    prompt: 'What bedroom size should the search focus on?',
    type: 'multi',
    required: true,
    options: [
      { value: 'studio', label: 'Studio' },
      { value: '1', label: '1 Bed' },
      { value: '2', label: '2 Beds' },
      { value: '3', label: '3 Beds' },
      { value: '4plus', label: '4+ Beds' },
    ],
  },
  {
    id: 'review',
    field: null,
    prompt: 'I have enough to mark this handoff sales-ready.',
    helper: 'Review the summary, then continue. This is not an approval, a guarantee, or a lease offer.',
    type: 'review',
    nextLabel: 'Prepare My Review & Continue',
  },
];

let agentState = {
  agent: 'agent-number-one',
  version: '1.0',
  stepIndex: 0,
  status: 'collecting',
  intent: 'general_renter',
  answers: { current_rent: 0 },
  activity: [],
};
let isSubmitting = false;
let isFlushing = false;

const N = (value) => Number(value || 0).toLocaleString();

function nowIso() {
  return new Date().toISOString();
}

function emitAgentActivity(type, detail = {}) {
  const event = {
    type,
    at: nowIso(),
    step: QUESTIONS[agentState.stepIndex] ? QUESTIONS[agentState.stepIndex].id : 'complete',
    status: agentState.status,
    intent: agentState.intent,
    ...detail,
  };
  agentState.activity.push(event);
  if (agentState.activity.length > 80) agentState.activity = agentState.activity.slice(-80);
  rrTrack('agent_number_one_activity', { agentActivity: event });
  saveAgentState();
  return event;
}

function classifyIntent(answers) {
  const urgent = ['asap', '1_month'].includes(answers.move_timeline);
  const income = Number(answers.annual_income) || 0;
  const rent = Number(answers.rent_budget) || 0;
  const credit = answers.credit_score || '';
  const lowCredit = ['below_580', '580_619', '620_659'].includes(credit);
  const incomeTight = income && rent ? income / 12 < rent * 3 : false;
  if (urgent && lowCredit) return 'urgent_credit_support';
  if (urgent) return 'urgent_move';
  if (lowCredit) return 'credit_support';
  if (incomeTight) return 'income_fit_review';
  return 'general_renter';
}

function salesReady(answers) {
  return !!(
    answers.first_name &&
    answers.last_name &&
    answers.email &&
    answers.phone &&
    answers.contact_method &&
    answers.preferred_city &&
    answers.move_timeline &&
    answers.annual_income &&
    answers.rent_budget &&
    answers.credit_score &&
    answers.beds_needed
  );
}

function updateAgentStatus() {
  agentState.intent = classifyIntent(agentState.answers);
  agentState.status = salesReady(agentState.answers) ? 'sales-ready' : 'collecting';
  return agentState.status;
}

function saveAgentState() {
  try {
    sessionStorage.setItem(AGENT_STATE_KEY, JSON.stringify(agentState));
    localStorage.setItem(AGENT_STATE_KEY, JSON.stringify(agentState));
  } catch (_e) {}
}

function loadAgentState() {
  try {
    const raw = sessionStorage.getItem(AGENT_STATE_KEY) || localStorage.getItem(AGENT_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.agent === 'agent-number-one' && parsed.answers) {
      agentState = {
        ...agentState,
        ...parsed,
        answers: { current_rent: 0, ...(parsed.answers || {}) },
        activity: Array.isArray(parsed.activity) ? parsed.activity : [],
      };
      updateAgentStatus();
    }
  } catch (_e) {}
}

function updateProgress() {
  const pct = Math.round((agentState.stepIndex / (QUESTIONS.length - 1)) * 100);
  const fill = document.getElementById('agentProgress');
  const tag = document.getElementById('agentStepTag');
  if (fill) fill.style.width = pct + '%';
  if (tag) tag.textContent = agentState.status === 'sales-ready' ? 'Sales-ready handoff' : `Question ${Math.max(1, agentState.stepIndex)} / ${QUESTIONS.length - 1}`;
}

function labelFor(question, value) {
  if (Array.isArray(value)) return value.map((item) => labelFor(question, item)).join(', ');
  const opt = question && question.options && question.options.find((item) => item.value === value);
  return opt ? opt.label : String(value || '');
}

function messageHtml(role, text, helper = '') {
  return `
    <div class="agent-message agent-message-${role}">
      <div class="agent-message-name">${role === 'agent' ? 'Agent Number One' : 'You'}</div>
      <div class="agent-bubble">${escapeHtml(text)}${helper ? `<p>${escapeHtml(helper)}</p>` : ''}</div>
    </div>
  `;
}

function renderConversation() {
  const mount = document.getElementById('agentConversation');
  if (!mount) return;
  const current = QUESTIONS[agentState.stepIndex];
  const answered = QUESTIONS
    .slice(1, agentState.stepIndex)
    .filter((q) => q.field && agentState.answers[q.field])
    .map((q) => {
      const value = q.type === 'multi' ? String(agentState.answers[q.field]).split(',').filter(Boolean) : agentState.answers[q.field];
      return messageHtml('agent', q.prompt) + messageHtml('user', labelFor(q, value));
    })
    .join('');
  mount.innerHTML = answered + messageHtml('agent', current.prompt, current.helper);
  mount.scrollTop = mount.scrollHeight;
}

function renderResponse() {
  const mount = document.getElementById('agentResponseMount');
  const next = document.getElementById('agentNext');
  const back = document.getElementById('agentBack');
  const err = document.getElementById('agentError');
  if (!mount || !next || !back || !err) return;
  const question = QUESTIONS[agentState.stepIndex];
  const value = question.field ? agentState.answers[question.field] : '';
  err.textContent = '';
  err.classList.remove('show');
  back.disabled = agentState.stepIndex === 0 || isSubmitting;
  next.disabled = isSubmitting;
  next.innerHTML = `${question.nextLabel || (agentState.stepIndex === QUESTIONS.length - 1 ? 'Continue' : 'Next')} <span class="ic"><svg width="16" height="16" style="stroke:#fff"><use href="#i-right"/></svg></span>`;

  if (question.type === 'start') {
    mount.innerHTML = '';
    return;
  }
  if (question.type === 'review') {
    mount.innerHTML = buildReviewHtml();
    return;
  }
  if (question.type === 'choice' || question.type === 'multi') {
    const selected = question.type === 'multi' ? String(value || '').split(',').filter(Boolean) : [value];
    mount.innerHTML = `<div class="agent-options">${question.options.map((opt) => `
      <button type="button" class="agent-option ${selected.includes(opt.value) ? 'selected' : ''}" data-value="${escapeAttr(opt.value)}">${escapeHtml(opt.label)}</button>
    `).join('')}</div>`;
    mount.querySelectorAll('.agent-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (question.type === 'multi') {
          const values = new Set(String(agentState.answers[question.field] || '').split(',').filter(Boolean));
          if (values.has(btn.dataset.value)) values.delete(btn.dataset.value);
          else values.add(btn.dataset.value);
          agentState.answers[question.field] = Array.from(values).join(',');
        } else {
          agentState.answers[question.field] = btn.dataset.value;
        }
        updateAgentStatus();
        saveAgentState();
        renderResponse();
      });
    });
    return;
  }
  if (question.type === 'range') {
    const current = Number(value || question.defaultValue);
    mount.innerHTML = `
      <div class="agent-range-value" id="agentRangeValue">${question.prefix || ''}${N(current)}${question.suffix || ''}</div>
      <input class="agent-range" id="agentInput" type="range" min="${question.min}" max="${question.max}" step="${question.step}" value="${current}" required>
    `;
    const input = document.getElementById('agentInput');
    const valueEl = document.getElementById('agentRangeValue');
    input.addEventListener('input', () => {
      agentState.answers[question.field] = Number(input.value);
      updateAgentStatus();
      saveAgentState();
      if (valueEl) valueEl.textContent = `${question.prefix || ''}${N(input.value)}${question.suffix || ''}`;
    });
    return;
  }
  mount.innerHTML = `
    <label class="agent-input-label" for="agentInput">${escapeHtml(question.prompt)}</label>
    <input class="agent-input" id="agentInput" type="${question.type}" autocomplete="${question.autocomplete || 'off'}" placeholder="${escapeAttr(question.placeholder || '')}" value="${escapeAttr(value || '')}" ${question.required ? 'required' : ''}>
  `;
  const input = document.getElementById('agentInput');
  input.focus({ preventScroll: true });
}

function buildReviewHtml() {
  updateAgentStatus();
  const rows = [
    ['Name', `${agentState.answers.first_name || ''} ${agentState.answers.last_name || ''}`.trim()],
    ['Email', agentState.answers.email],
    ['Phone', agentState.answers.phone],
    ['Contact Via', labelFor(QUESTIONS.find((q) => q.field === 'contact_method'), agentState.answers.contact_method)],
    ['City', agentState.answers.preferred_city],
    ['Timeline', labelFor(QUESTIONS.find((q) => q.field === 'move_timeline'), agentState.answers.move_timeline)],
    ['Reason', labelFor(QUESTIONS.find((q) => q.field === 'move_reason'), agentState.answers.move_reason)],
    ['Annual Income', '$' + N(agentState.answers.annual_income)],
    ['Rent Budget', '$' + N(agentState.answers.rent_budget) + '/mo'],
    ['Credit Score', labelFor(QUESTIONS.find((q) => q.field === 'credit_score'), agentState.answers.credit_score)],
    ['Bedrooms', labelFor(QUESTIONS.find((q) => q.field === 'beds_needed'), String(agentState.answers.beds_needed || '').split(',').filter(Boolean))],
    ['Agent Status', agentState.status],
    ['Intent', agentState.intent.replace(/_/g, ' ')],
  ];
  return `<div class="summary agent-summary">${rows.filter((row) => row[1]).map((row) => `
    <div class="summary-row"><span class="lbl">${escapeHtml(row[0])}</span><span class="val">${escapeHtml(String(row[1]))}</span></div>
  `).join('')}</div>`;
}

function showError(message) {
  const err = document.getElementById('agentError');
  if (!err) return;
  err.textContent = message;
  err.classList.add('show');
}

function currentQuestionValue() {
  const question = QUESTIONS[agentState.stepIndex];
  if (!question.field) return true;
  if (question.type === 'text' || question.type === 'email' || question.type === 'tel') {
    const input = document.getElementById('agentInput');
    const value = String((input && input.value) || '').trim();
    if (question.required && !value) return '';
    if (question.type === 'email' && input && !input.checkValidity()) return '';
    agentState.answers[question.field] = value;
    return value;
  }
  if (question.type === 'range') {
    agentState.answers[question.field] = Number(agentState.answers[question.field] || question.defaultValue);
    return agentState.answers[question.field];
  }
  return agentState.answers[question.field] || '';
}

function advanceAgent() {
  const question = QUESTIONS[agentState.stepIndex];
  const value = currentQuestionValue();
  if (question.required && !value) {
    showError(question.type === 'email' ? 'Enter a valid email address to continue.' : 'Answer this question to continue.');
    return;
  }
  if (question.field) {
    emitAgentActivity('answer_captured', { field: question.field });
  }
  updateAgentStatus();
  if (agentState.stepIndex === QUESTIONS.length - 1) {
    submitLead();
    return;
  }
  agentState.stepIndex += 1;
  if (QUESTIONS[agentState.stepIndex].id === 'review') {
    updateAgentStatus();
    emitAgentActivity('intent_classified', { intent: agentState.intent });
    emitAgentActivity('handoff_ready', { handoffStatus: agentState.status });
  } else {
    emitAgentActivity('question_presented', { question: QUESTIONS[agentState.stepIndex].id });
  }
  saveAgentState();
  render();
}

function retreatAgent() {
  if (agentState.stepIndex <= 0 || isSubmitting) return;
  agentState.stepIndex -= 1;
  emitAgentActivity('back_clicked', { question: QUESTIONS[agentState.stepIndex].id });
  saveAgentState();
  render();
}

function collectPayload() {
  updateAgentStatus();
  const payload = {
    lead_id: crypto.randomUUID ? crypto.randomUUID() : ('lead_' + Date.now() + '_' + Math.random().toString(36).slice(2)),
    submitted_at: nowIso(),
    received_at: nowIso(),
    first_name: agentState.answers.first_name || '',
    last_name: agentState.answers.last_name || '',
    date_of_birth: '',
    email: agentState.answers.email || '',
    phone: agentState.answers.phone || '',
    contact_method: agentState.answers.contact_method || '',
    preferred_city: agentState.answers.preferred_city || '',
    move_timeline: agentState.answers.move_timeline || '',
    move_reason: agentState.answers.move_reason || '',
    annual_income: Number(agentState.answers.annual_income) || '',
    rent_budget: Number(agentState.answers.rent_budget) || '',
    current_rent: 0,
    credit_score: agentState.answers.credit_score || '',
    beds_needed: agentState.answers.beds_needed || '',
    source_page: window.location.href,
    referrer: document.referrer || '',
    user_agent: navigator.userAgent || '',
    agent_status: agentState.status,
    agent_intent: agentState.intent,
    agent_state: {
      agent: agentState.agent,
      version: agentState.version,
      status: agentState.status,
      intent: agentState.intent,
      current_step: 'handoff',
      handoff: {
        target: 'sales-agent',
        status: agentState.status,
        ready: agentState.status === 'sales-ready',
      },
    },
    agent_activity: agentState.activity,
  };
  return window.rrnAttachManyChatContactId ? window.rrnAttachManyChatContactId(payload) : payload;
}

async function sendToSheets(payload) {
  if (!GOOGLE_SCRIPT_URL) return false;
  try {
    const res = await fetch(GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return !!(res.ok && data && data.ok);
  } catch (_err) {
    return false;
  }
}

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(LEAD_QUEUE_KEY) || '[]'); }
  catch (_e) { return []; }
}

function saveQueue(q) {
  try { localStorage.setItem(LEAD_QUEUE_KEY, JSON.stringify(q)); } catch (_e) {}
}

function enqueue(payload) {
  const q = loadQueue();
  q.push(payload);
  saveQueue(q);
}

async function flushQueue() {
  if (isFlushing) return loadQueue().length;
  isFlushing = true;
  try {
    const q = loadQueue();
    if (!q.length) return 0;
    const remaining = [];
    for (const p of q) {
      const ok = await sendToSheets(p);
      if (!ok) remaining.push(p);
    }
    saveQueue(remaining);
    return remaining.length;
  } finally {
    isFlushing = false;
  }
}

async function submitLead() {
  if (isSubmitting) return;
  if (agentState.status !== 'sales-ready') {
    showError('Agent Number One still needs the required details before the handoff can continue.');
    return;
  }
  isSubmitting = true;
  const btn = document.getElementById('agentNext');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }
  emitAgentActivity('lead_submitting', { handoffStatus: agentState.status });
  const payload = collectPayload();
  enqueue(payload);
  try {
    sessionStorage.setItem(ANSWERS_STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem(ANSWERS_STORAGE_KEY, JSON.stringify(payload));
    sessionStorage.setItem(AGENT_STATE_KEY, JSON.stringify({ ...agentState, lead_id: payload.lead_id }));
    localStorage.setItem(AGENT_STATE_KEY, JSON.stringify({ ...agentState, lead_id: payload.lead_id }));
  } catch (_e) {}
  try {
    flushQueue().catch(() => {});
    emitAgentActivity('lead_submitted', { leadId: payload.lead_id });
    rrTrack('questionnaire_completed', { agent_status: payload.agent_status, agent_intent: payload.agent_intent });
    setTimeout(() => {
      window.location.href = POST_SUBMIT_REDIRECT_URL;
    }, POST_SUBMIT_REDIRECT_DELAY_MS);
  } catch (err) {
    showError(`Something went wrong: ${err.message}. Please try again.`);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Prepare My Review & Continue <span class="ic"><svg width="16" height="16" style="stroke:#fff"><use href="#i-right"/></svg></span>';
    }
    isSubmitting = false;
  }
}

function render() {
  updateAgentStatus();
  updateProgress();
  renderConversation();
  renderResponse();
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

window.addEventListener('DOMContentLoaded', () => {
  loadAgentState();
  updateAgentStatus();
  if (!agentState.activity.length) emitAgentActivity('agent_started', { question: QUESTIONS[0].id });
  render();
  const form = document.getElementById('agentForm');
  const back = document.getElementById('agentBack');
  if (form) form.addEventListener('submit', (event) => { event.preventDefault(); advanceAgent(); });
  if (back) back.addEventListener('click', retreatAgent);
  flushQueue();
  window.addEventListener('online', flushQueue);
  window.addEventListener('focus', () => {
    if (loadQueue().length) flushQueue();
  });
});
