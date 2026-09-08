
const ANSWERS_KEY = 'rrn_answers_v1';
const START_URL = '/index.html';

function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function loadAnswers() {
  try { return JSON.parse(sessionStorage.getItem(ANSWERS_KEY) || 'null'); }
  catch (_e) { return null; }
}

function svgCheck(){ return '<svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>'; }
function svgArrow(){ return '<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'; }

function render(answers, ent) {
  const first = (answers && answers.first_name) || 'there';

  let subtitle;
  if (ent && ent.membershipStatus === 'active') {
    subtitle = 'Your RentReady Support access information is on its way to your email.';
  } else if (ent && ent.paid97) {
    subtitle = 'Your purchased RentReady resources have been sent to your email.';
  } else if (ent && ent.paid27) {
    subtitle = 'Your RentReady Game Plan has been sent to the email you provided.';
  } else {
    subtitle = 'Your RentReady results are ready whenever you need them.';
  }

  const links = [];
  if (ent && ent.paid10) {
    links.push(`<a class="btn-secondary" href="/.netlify/functions/download-result-pdf?leadId=${encodeURIComponent(answers.lead_id)}">Download My Pre-Screen Results</a>`);
  }
  if (ent && ent.paid27) {
    links.push(`<a class="btn-secondary" href="/.netlify/functions/download-file?leadId=${encodeURIComponent(answers.lead_id)}&product=gameplan">Download My Game Plan</a>`);
  }
  if (ent && ent.paid97) {
    links.push(`<a class="btn-secondary" href="/.netlify/functions/download-file?leadId=${encodeURIComponent(answers.lead_id)}&product=creditkit">Download My Credit Action Kit</a>`);
  }
  links.push(`<a class="btn-primary" href="/after-payment-results/">Back To My RentReady Results ${svgArrow()}</a>`);

  document.getElementById('content').innerHTML = `
    <div class="brand">
      <div class="brand-icon"><svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg></div>
      RentReady <strong>Network</strong>
    </div>
    <div class="check-badge">${svgCheck()}</div>
    <div class="eyebrow">All Set</div>
    <div class="title">${esc(first)}, you're <strong>all set.</strong></div>
    <div class="subtitle">${subtitle}</div>
    <div class="links">${links.join('')}</div>
  `;
}

(async function boot() {
  const answers = loadAnswers();
  if (!answers || !answers.lead_id) {
    window.location.replace(START_URL);
    return;
  }
  const ent = await rrnFetchEntitlements(answers.lead_id);
  if (!ent || !ent.paid10) {
    window.location.replace(START_URL);
    return;
  }
  render(answers, ent);
})();
