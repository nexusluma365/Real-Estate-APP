
const ANSWERS_STORAGE_KEY = 'rrn_answers_v1';
const RESULTS_URL = '/rentready-review-checkout';
const FLOW_ACCESS_KEY = 'rrn_flow_access_v1';

function loadAnswers() {
  try { return JSON.parse(sessionStorage.getItem(ANSWERS_STORAGE_KEY) || 'null'); }
  catch (_e) { return null; }
}

const answers = loadAnswers();

// Only list steps that reflect information the visitor actually provided.
const steps = [];
if (answers && answers.annual_income) steps.push('Income information received');
if (answers && answers.rent_budget) steps.push('Rent budget received');
if (answers && answers.credit_score) steps.push('Credit range received');
if (answers && answers.move_timeline) steps.push('Move timeline received');
steps.push('RentReady summary prepared');

if (!steps.length) {
  steps.push('Answers received', 'RentReady summary prepared');
}

const list = document.getElementById('checklist');
steps.forEach((label, i) => {
  const row = document.createElement('div');
  row.className = 'check-row';
  row.id = 'row-' + i;
  row.innerHTML = `<span class="dot"><svg viewBox="0 0 24 24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></span><span class="lbl">${label}</span>`;
  list.appendChild(row);
});

const progFill = document.getElementById('progFill');
const statusLine = document.getElementById('statusLine');
const total = steps.length;

let i = 0;
function tick() {
  if (i >= total) {
    statusLine.textContent = 'Redirecting to your results...';
    try {
      sessionStorage.setItem(FLOW_ACCESS_KEY, JSON.stringify({
        step: 'prescreen-checkout',
        status: 'confirmed',
        at: Date.now(),
      }));
    } catch (_e) {}
    setTimeout(() => { window.location.href = RESULTS_URL; }, 550);
    return;
  }
  document.getElementById('row-' + i).classList.add('done');
  i++;
  progFill.style.width = Math.round((i / total) * 100) + '%';
  statusLine.textContent = i < total ? 'Reviewing your answers...' : 'Almost ready...';
  setTimeout(tick, 480);
}
setTimeout(tick, 400);
