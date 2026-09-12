
// ── CONFIG ─────────────────────────────────────────────────────
const GOOGLE_SCRIPT_URL = '/.netlify/functions/submit-lead';
const LEAD_QUEUE_KEY = 'rrn_leads_v2';
const POST_SUBMIT_REDIRECT_URL = '/results-processing.html';
const ANSWERS_STORAGE_KEY = 'rrn_answers_v1';
const POST_SUBMIT_REDIRECT_DELAY_MS = 3000;
// ───────────────────────────────────────────────────────────────

const TOTAL = 8;
let cur = 0;
let isSubmitting = false;
let isFlushing = false;

function updateProg(step) {
  document.getElementById('prog').style.width = (step === 0 ? 0 : Math.round(step/TOTAL*100)) + '%';
  document.getElementById('stepTag').textContent = (step > 0 && step < 9) ? `${step} / ${TOTAL}` : '';
}

function goTo(idx, dir) {
  const c = document.getElementById('slide-'+cur);
  const n = document.getElementById('slide-'+idx);
  const ec = dir==='right' ? 'exit-left'  : 'exit-right';
  const en = dir==='right' ? 'enter-right': 'enter-left';
  c.classList.add(ec);
  c.addEventListener('animationend', ()=>c.classList.remove('active',ec), {once:true});
  n.classList.add('active',en);
  n.addEventListener('animationend', ()=>n.classList.remove(en), {once:true});
  cur = idx; updateProg(idx);
  if (idx===8) buildSummary();
}

function sel(gid, el, multi=false) {
  const g = document.getElementById(gid);
  if (!multi) { g.querySelectorAll('.pill').forEach(p=>p.classList.remove('selected')); el.classList.add('selected'); }
  else el.classList.toggle('selected');
  g.classList.remove('invalid');
}

function getVal(gid, multi=false) {
  const g = document.getElementById(gid);
  const s = [...g.querySelectorAll('.pill.selected')].map(p=>p.dataset.val);
  return multi ? s : (s[0]||'');
}

function pickScore(bar, val) {
  document.querySelectorAll('.score-bar').forEach(b=>b.classList.remove('active'));
  bar.classList.add('active');
  const scorePills = document.getElementById('credit_score_pills');
  scorePills.classList.remove('invalid');
  scorePills.querySelectorAll('.pill')
    .forEach(p=>p.classList.toggle('selected', p.dataset.val===val));
}

const N = v => Number(v).toLocaleString();
function rng(id, vid, fmt) {
  const el = document.getElementById(id);
  document.getElementById(vid).textContent = fmt(el.value);
  const pct = ((el.value-el.min)/(el.max-el.min))*100;
  el.style.background = `linear-gradient(90deg,var(--green) ${pct}%,#D5E2DA ${pct}%)`;
}

function todayMinusYears(years) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function isAtLeast17(dateValue) {
  if (!dateValue) return false;
  const selected = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(selected.getTime())) return false;
  return selected <= new Date(`${todayMinusYears(17)}T00:00:00`);
}

function markFieldInvalid(el, message) {
  if (!el) return;
  if (message && typeof el.setCustomValidity === 'function') el.setCustomValidity(message);
  el.classList.add('invalid');
  el.addEventListener('input', () => {
    el.classList.remove('invalid');
    if (typeof el.setCustomValidity === 'function') el.setCustomValidity('');
  }, { once: true });
}

function validateFields(fields = [], pillGroups = []) {
  let ok = true;
  fields.forEach(id=>{
    const el = document.getElementById(id);
    let invalid = !el || !String(el.value || '').trim() || (el.type === 'email' && !el.checkValidity());
    if (id === 'date_of_birth') invalid = invalid || !isAtLeast17(el.value);
    if (invalid) {
      markFieldInvalid(el, id === 'date_of_birth' ? 'You must be at least 17 years old to continue.' : '');
      ok = false;
    }
  });
  pillGroups.forEach(id => {
    const group = document.getElementById(id);
    const selected = group && group.querySelector('.pill.selected');
    if (!selected) {
      group && group.classList.add('invalid');
      ok = false;
    }
  });
  return ok;
}

function validateAndNext(toSlide, fields, pillGroups = []) {
  const ok = validateFields(fields, pillGroups);
  if (ok) goTo(toSlide,'right');
}

function validateEntireQuestionnaire() {
  const checks = [
    { slide: 1, fields: ['first_name','last_name','date_of_birth'], groups: [] },
    { slide: 2, fields: ['email','phone'], groups: ['contact_method_pills'] },
    { slide: 3, fields: ['preferred_city'], groups: ['move_timeline_pills'] },
    { slide: 4, fields: [], groups: ['move_reason_pills'] },
    { slide: 5, fields: ['annual_income','rent_budget','current_rent'], groups: [] },
    { slide: 6, fields: [], groups: ['credit_score_pills'] },
    { slide: 7, fields: [], groups: ['beds_needed_pills'] },
  ];
  for (const check of checks) {
    if (!validateFields(check.fields, check.groups)) {
      if (cur !== check.slide) goTo(check.slide, check.slide > cur ? 'right' : 'left');
      return false;
    }
  }
  return true;
}

function buildSummary() {
  const rows = [
    ['Name',          `${v('first_name')} ${v('last_name')}`],
    ['Date of Birth', v('date_of_birth')],
    ['Email',         v('email')],
    ['Phone',         v('phone')],
    ['Contact Via',   getVal('contact_method_pills').replace(/_/g,' ')],
    ['City',          v('preferred_city')],
    ['Timeline',      getVal('move_timeline_pills').replace(/_/g,' ')],
    ['Reason',        getVal('move_reason_pills').replace(/_/g,' ')],
    ['Annual Income', '$'+N(document.getElementById('annual_income').value)],
    ['Rent Budget',   '$'+N(document.getElementById('rent_budget').value)+'/mo'],
    ['Current Rent',  '$'+N(document.getElementById('current_rent').value)+'/mo'],
    ['Credit Score',  getVal('credit_score_pills').replace(/_/g,' ')],
    ['Bedrooms',      getVal('beds_needed_pills',true).join(', ')],
  ];
  document.getElementById('summary-box').innerHTML = rows.filter(r=>r[1]&&r[1].trim()).map(r=>
    `<div class="summary-row"><span class="lbl">${r[0]}</span><span class="val">${r[1]}</span></div>`
  ).join('');
}

function v(id) { return (document.getElementById(id)||{}).value||''; }

function updateSuccessMessageByCredit(creditScore) {
  const eyebrow = document.getElementById('success-eyebrow');
  const subtitle = document.getElementById('success-subtitle');
  if (!eyebrow || !subtitle) return;

  if (creditScore === '740_799') {
    eyebrow.textContent = "Congrats you're pre-Qualified";
    subtitle.textContent = "congrats you've been pre-Qualified";
    return;
  }

  eyebrow.textContent = "Application Update";
  subtitle.textContent = "based on your answers you may have to put a Deposit down but Final decision is the Leasing company";
}

function toNumberOrEmpty(id) {
  const n = parseInt(document.getElementById(id).value, 10);
  return Number.isFinite(n) ? n : '';
}

function collectPayload() {
  return {
    lead_id:        crypto.randomUUID ? crypto.randomUUID() : ('lead_' + Date.now() + '_' + Math.random().toString(36).slice(2)),
    submitted_at:   new Date().toISOString(),
    received_at:    new Date().toISOString(),
    first_name:     v('first_name'),
    last_name:      v('last_name'),
    date_of_birth:  v('date_of_birth'),
    email:          v('email'),
    phone:          v('phone'),
    contact_method: getVal('contact_method_pills'),
    preferred_city: v('preferred_city'),
    move_timeline:  getVal('move_timeline_pills'),
    move_reason:    getVal('move_reason_pills'),
    annual_income:  toNumberOrEmpty('annual_income'),
    rent_budget:    toNumberOrEmpty('rent_budget'),
    current_rent:   toNumberOrEmpty('current_rent'),
    credit_score:   getVal('credit_score_pills'),
    beds_needed:    getVal('beds_needed_pills',true).join(','),
    source_page:    window.location.href,
    referrer:       document.referrer||'',
    user_agent:     navigator.userAgent||'',
  };
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
  if (!validateEntireQuestionnaire()) return;
  isSubmitting = true;
  const btn = document.getElementById('submitBtn');
  const errEl = document.getElementById('submitErr');
  errEl.classList.remove('show');
  btn.innerHTML = 'Submitting…';
  btn.disabled = true;

  const payload = collectPayload();
  enqueue(payload);

  try {
    sessionStorage.setItem(ANSWERS_STORAGE_KEY, JSON.stringify(payload));
    localStorage.setItem(ANSWERS_STORAGE_KEY, JSON.stringify(payload));
  } catch (_e) {}

  try {
    flushQueue().catch(() => {});
    updateSuccessMessageByCredit(payload.credit_score);
    document.getElementById('success-name').textContent = payload.first_name||'there';
    goTo(9,'right');
    setTimeout(() => {
      window.location.href = POST_SUBMIT_REDIRECT_URL;
    }, POST_SUBMIT_REDIRECT_DELAY_MS);
  } catch (err) {
    const e = document.getElementById('submitErr');
    e.textContent=`Something went wrong: ${err.message}. Please try again.`; e.classList.add('show');
    btn.innerHTML = 'Submit &amp; Get Matched <span class="ic"><svg width="16" height="16" style="stroke:#fff"><use href="#i-right"/></svg></span>';
    btn.disabled = false;
    isSubmitting = false;
  }
}

window.addEventListener('DOMContentLoaded',()=>{
  const birthdate = document.getElementById('date_of_birth');
  if (birthdate) birthdate.max = todayMinusYears(17);

  flushQueue();
  window.addEventListener('online', flushQueue);
  window.addEventListener('focus', () => {
    if (loadQueue().length) flushQueue();
  });

  setTimeout(()=>{
    ['annual_income','rent_budget','current_rent'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.dispatchEvent(new Event('input'));
    });
  },100);
});
