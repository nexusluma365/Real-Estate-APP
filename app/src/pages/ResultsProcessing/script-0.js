
const RESULTS_URL = '/rentready-review-checkout';
const FLOW_ACCESS_KEY = 'rrn_flow_access_v1';

// These steps describe processing the questionnaire answers only. They must
// not imply a credit pull, screening report, or landlord review.
const steps = [
  'Reviewing your answers...',
  'Checking common rental factors...',
  'Preparing your RentReady Results...',
  'Preparing your apartment search...',
];
const statusMessages = [
  'Reviewing your answers...',
  'Checking common rental factors...',
  'Preparing your RentReady Results...',
  'Preparing your apartment search...',
];
const STEP_MS = 430;
const READY_HOLD_MS = 650;

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

function showReady() {
  const eyebrow = document.getElementById('eyebrow');
  const title = document.getElementById('title');
  const subtitle = document.getElementById('subtitle');
  if (eyebrow) eyebrow.textContent = 'Review complete';
  if (title) {
    title.innerHTML = 'Your RentReady Results <strong>Are Ready</strong>';
    title.classList.add('is-ready');
  }
  if (subtitle) subtitle.textContent = 'Taking you to your results now.';
}

let i = 0;
function tick() {
  if (i >= total) {
    showReady();
    statusLine.textContent = 'Opening your results...';
    try {
      sessionStorage.setItem(FLOW_ACCESS_KEY, JSON.stringify({
        step: 'prescreen-checkout',
        status: 'confirmed',
        at: Date.now(),
      }));
    } catch (_e) {}
    setTimeout(() => { window.location.href = RESULTS_URL; }, READY_HOLD_MS);
    return;
  }
  document.getElementById('row-' + i).classList.add('done');
  i++;
  progFill.style.width = Math.round((i / total) * 100) + '%';
  statusLine.textContent = i < total ? statusMessages[i] : 'Almost ready...';
  setTimeout(tick, STEP_MS);
}
setTimeout(tick, 260);
