
const ANSWERS_KEY = 'rrn_answers_v1';
const PAID10_KEY = 'rrn_paid_10';
const PAID27_KEY = 'rrn_paid_27';
const RESULTS_URL = '/after-payment-results/';
const CREDIT_KIT_URL = '/credit-action-package.html';
const MEMBERSHIP_URL = '/membership.html';

// ── PAYMENT CONFIG ─────────────────────────────────────────────
// This is a real one-click charge against the card saved during the $10
// pre-screen — no card form, no redirect to Stripe's site. It's powered by
// the Netlify Functions in /netlify/functions (see charge-upsell.js) plus
// the shared /assets/checkout-client.js helper loaded below.
//
// Netlify serves Stripe's publishable key through /.netlify/functions/config.
const STRIPE_PUBLISHABLE_KEY = '';
// ─────────────────────────────────────────────────────────────

function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }


function loadAnswers() {
  try { return JSON.parse(sessionStorage.getItem(ANSWERS_KEY) || 'null'); }
  catch (_e) { return null; }
}

function svgCheck(){ return '<svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>'; }

function creditTier(code) {
  if (['below_580','580_619','620_659'].includes(code)) return 'low';
  if (['660_699','700_739'].includes(code)) return 'mid';
  if (['740_799','800_plus'].includes(code)) return 'strong';
  return 'unknown';
}
function incomeMeetsBenchmark(income, rent) {
  if (!income || !rent) return null;
  return (income / 12) >= (rent * 3);
}
function determineFocus(answers) {
  const income = Number(answers.annual_income) || null;
  const rent = Number(answers.rent_budget) || null;
  const tier = creditTier(answers.credit_score || '');
  const benchmarkMet = incomeMeetsBenchmark(income, rent);
  if (tier === 'low' || tier === 'mid') return 'credit';
  if (tier === 'strong' && benchmarkMet === false) return 'income';
  return 'general';
}

// ── RENDER: LOCKED (pre-payment) — the $27 offer ─────────────────
function renderLocked(answers) {
  const first = (answers && answers.first_name) || 'there';
  const container = document.getElementById('content');
  container.innerHTML = `
    <div class="card">
      <div class="eyebrow">Turn Your Results Into A Game Plan</div>
      <div class="h1">${esc(first)}, know what to <strong>do next.</strong></div>
      <div class="p">Now you know what may be affecting your rental profile.</div>
      <div class="p" style="margin-top:6px;">Your next step is knowing what to work on first.</div>
      <div class="p" style="margin-top:10px;">Instead of guessing what to do next, build a step-by-step plan around the answers you already gave us.</div>
    </div>

    <div class="card">
      <div class="eyebrow">Your RentReady Game Plan</div>
      <div class="check-points">
        <div class="check-point">${svgCheck()}<span>What to work on first</span></div>
        <div class="check-point">${svgCheck()}<span>What can wait</span></div>
        <div class="check-point">${svgCheck()}<span>What to prepare before applying</span></div>
        <div class="check-point">${svgCheck()}<span>Questions to ask before paying an application fee</span></div>
        <div class="check-point">${svgCheck()}<span>Your move-in preparation checklist</span></div>
        <div class="check-point">${svgCheck()}<span>A simple 30-day action plan based on your profile</span></div>
      </div>
      <div class="p" style="margin-top:14px;"><strong>You already know where you stand. Now know what to do next.</strong></div>

      <div class="pay-box">
        <div class="pay-row"><span class="pay-label">RentReady Game Plan</span><span class="pay-price">$27</span></div>
        <button class="btn-primary" id="gpBuyBtn" onclick="handleGamePlanPurchase()">Build My RentReady Game Plan <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        <div class="microcopy">One-time $27 · Uses your saved payment method</div>
        <div id="gpError"></div>
      </div>
      <a class="small-link" href="${RESULTS_URL}">Continue with my current results</a>
      <div class="disclosure">This charge uses the payment method you provided for your pre-screen. You'll always see the price and a clear button before anything is charged — nothing is billed automatically.</div>
    </div>
  `;
}

async function handleGamePlanPurchase() {
  const btn = document.getElementById('gpBuyBtn');
  const errBox = document.getElementById('gpError');
  if (btn.dataset.busy === '1') return; // guard against double-click / duplicate charge
  btn.dataset.busy = '1';
  btn.disabled = true;
  errBox.innerHTML = '';
  const originalLabel = btn.innerHTML;
  btn.innerHTML = 'Processing…';

  const stripeKey = await rrnGetStripePublishableKey(STRIPE_PUBLISHABLE_KEY);
  const status = await rrnChargeUpsell('gameplan', stripeKey);

  if (status === 'succeeded') {
    try { sessionStorage.setItem(PAID27_KEY, '1'); } catch (_e) {}
    renderUnlocked(loadAnswers());
    return;
  }

  if (status === 'processing') {
    btn.innerHTML = 'Confirming your payment…';
    pollForGamePlanCompletion(btn, originalLabel, errBox);
    return;
  }

  // Failed — restore the button, show the message, and only NOW fade in
  // the option to move on without this purchase.
  btn.disabled = false;
  btn.dataset.busy = '0';
  btn.innerHTML = originalLabel;
  errBox.innerHTML = `
    <div class="pay-error">We couldn't complete this purchase with your saved payment method.</div>
    <a class="small-link fade-in" href="#" onclick="skipGamePlan(event)">Continue Without This →</a>
  `;
}

function pollForGamePlanCompletion(btn, originalLabel, errBox) {
  const leadId = rrnLeadId();
  let attempts = 0;
  const check = async () => {
    attempts++;
    const ent = await rrnFetchEntitlements(leadId);
    if (ent && ent.paid27) {
      try { sessionStorage.setItem(PAID27_KEY, '1'); } catch (_e) {}
      renderUnlocked(loadAnswers());
      return;
    }
    if (attempts >= 6) {
      btn.disabled = false;
      btn.dataset.busy = '0';
      btn.innerHTML = originalLabel;
      errBox.innerHTML = `
        <div class="pay-error">Your payment is still processing. It's safe to check back shortly.</div>
        <a class="small-link fade-in" href="#" onclick="skipGamePlan(event)">Continue Without This →</a>
      `;
      return;
    }
    setTimeout(check, 2000);
  };
  setTimeout(check, 2000);
}

function skipGamePlan(evt) {
  if (evt) evt.preventDefault();
  renderSkipped();
}

async function handleEmailGamePlan() {
  const btn = document.getElementById('gpEmailBtn');
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = 'Sending…';
  btn.disabled = true;
  const ok = await rrnEmailAsset('gameplan');
  btn.textContent = ok ? 'Sent ✓' : 'Could Not Send — Try Again';
  btn.disabled = ok;
}

// ── RENDER: SKIPPED — moved on without buying, no product delivered ──
function renderSkipped() {
  const container = document.getElementById('content');
  container.innerHTML = `
    <div class="card">
      <div class="eyebrow">Continuing Without The Game Plan</div>
      <div class="h2">No problem — you can pick this up again any time.</div>
      <div class="p">Your $10 pre-screen results are still yours. Here's what's next.</div>
      <a class="btn-secondary" href="${MEMBERSHIP_URL}">See RentReady Support →</a>
      <a class="small-link" href="${RESULTS_URL}">Back to my pre-screen results</a>
    </div>
  `;
}

// ── RENDER: UNLOCKED (post-payment) — the actual game plan ───────
function renderUnlocked(answers) {
  const first = answers.first_name || 'there';
  const focus = determineFocus(answers);

  const priorities = focus === 'credit' ? [
    { t: 'Review what\'s on your credit and rental history', p: 'Pull your reports and look for anything that looks inaccurate, incomplete, or unfamiliar before a landlord does.' },
    { t: 'Strengthen your documentation', p: 'Line up pay stubs, ID, and proof of address so nothing slows your application down once you\'re ready.' },
    { t: 'Confirm your move-in budget', p: 'Know your realistic upfront number — deposit, first month, and any fees — before you start touring.' },
  ] : focus === 'income' ? [
    { t: 'Close the gap between income and rent budget', p: 'Consider a slightly different rent range, a qualified co-signer where accepted, or additional income documentation.' },
    { t: 'Keep your credit profile in good shape', p: 'It already looks like one of your stronger areas — don\'t let new balances or missed payments change that before you apply.' },
    { t: 'Prepare your documents and rental history', p: 'Have references, past landlord contacts, and proof of income ready to go.' },
  ] : [
    { t: 'Prepare your documents and rental history', p: 'Pay stubs, ID, proof of address, and references — ready before you need them, not after.' },
    { t: 'Confirm your move-in budget', p: 'Know your realistic upfront number so an application fee doesn\'t catch you off guard.' },
    { t: 'Shortlist properties that fit your criteria', p: 'Use your budget and timeline to narrow down where you actually apply.' },
  ];

  const checklist = focus === 'credit' ? [
    'Pull your credit reports from all three bureaus',
    'Gather pay stubs or income documentation',
    'Have a government-issued ID ready',
    'Collect previous landlord contact information',
    'Confirm your move-in budget, including deposit and fees',
  ] : [
    'Gather pay stubs or income documentation',
    'Have a government-issued ID ready',
    'Collect previous landlord contact information',
    'Confirm your move-in budget, including deposit and fees',
    'Write down 2–3 questions to ask before applying',
  ];

  const weeks = [
    { t: 'Week 1', p: focus === 'credit' ? 'Pull your credit reports and read through them line by line. Note anything that looks off.' : 'Gather your documents — pay stubs, ID, proof of address, and landlord references.' },
    { t: 'Week 2', p: focus === 'credit' ? 'Decide which items, if any, are worth formally reviewing or disputing.' : 'Confirm your move-in budget and shortlist 3–5 properties that fit your criteria.' },
    { t: 'Week 3', p: 'Reach out to previous landlords or references so they\'re expecting a call.' },
    { t: 'Week 4', p: 'Do a final review of your rental profile, then start applying with confidence.' },
  ];

  const container = document.getElementById('content');
  let html = `
    <div class="card">
      <div class="check-badge">${svgCheck()}</div>
      <div class="eyebrow">Game Plan Unlocked</div>
      <div class="h1">${esc(first)}, here's your <strong>RentReady Game Plan.</strong></div>
      <div class="p">A step-by-step plan built around the answers you already gave us.</div>
    </div>

    <div class="card">
      <div class="h2">Your Priorities</div>
      ${priorities.map((pr,i) => `
        <div class="priority">
          <div class="priority-num">${i+1}</div>
          <div><div class="priority-t">${esc(pr.t)}</div><div class="priority-p">${esc(pr.p)}</div></div>
        </div>`).join('')}
    </div>

    <div class="card">
      <div class="h2">Before You Apply</div>
      <div class="checklist">
        ${checklist.map(c => `<div class="chk-row">${svgCheck()}<span>${esc(c)}</span></div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="h2">Your 30-Day Plan</div>
      ${weeks.map(w => `<div class="week"><div class="week-t">${w.t}</div><div class="week-p">${w.p}</div></div>`).join('')}
    </div>

    <div class="card">
      <div class="h2">Your Game Plan Is Ready</div>
      <div class="p">Download it any time, or we can send a copy to your email.</div>
      <a class="btn-secondary" href="${rrnDownloadUrl('gameplan')}">Download My Game Plan</a>
      <button class="btn-secondary" id="gpEmailBtn" onclick="handleEmailGamePlan()" style="cursor:pointer;">Email My Game Plan</button>
    </div>
  `;

  if (focus === 'credit') {
    html += `
    <div class="card">
      <div class="eyebrow">One Part Of Your Game Plan Deserves A Closer Look</div>
      <div class="h2">Your answers suggest your credit or rental history is worth reviewing before you apply.</div>
      <div class="p">If something being reported is inaccurate, incomplete, or cannot be properly verified, knowing how to review and challenge that information can help you take the right next step.</div>
      <a class="btn-primary" href="${CREDIT_KIT_URL}">Add The Credit Action Kit <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      <div class="microcopy">One-time $97 · One-click purchase</div>
      <a class="small-link" href="${MEMBERSHIP_URL}">Continue with my current game plan</a>
    </div>
    `;
  } else {
    html += `
    <div class="card">
      <div class="eyebrow">You Don't Have To Figure Out Every Next Step Alone</div>
      <div class="h2">Getting rental-ready can take more than one day.</div>
      <div class="p">Questions come up. Documents change. And eventually, it's time to decide where and when to apply. RentReady Support gives you a place to keep moving forward.</div>
      <a class="btn-secondary" href="${MEMBERSHIP_URL}">See RentReady Support →</a>
    </div>
    `;
  }

  container.innerHTML = html;
}

// ── BOOT ──────────────────────────────────────────────────────
(async function boot() {
  const answers = loadAnswers();
  const container = document.getElementById('content');

  if (!answers) {
    container.innerHTML = `
      <div class="card center">
        <div class="eyebrow">Pre-Screen Required</div>
        <div class="h2">Complete your RentReady pre-screen first.</div>
        <div class="p">Your Game Plan is built from your pre-screen results.</div>
        <a class="btn-primary" href="${RESULTS_URL}">Go To My Pre-Screen <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      </div>`;
    return;
  }

  // Server-side entitlements are the source of truth — this is what makes
  // a refresh, a back-button press, or a returning visit on a new tab all
  // show the correct state instead of trusting only this browser's
  // sessionStorage flags.
  const ent = await rrnFetchEntitlements(answers.lead_id);

  if (!ent || !ent.paid10) {
    container.innerHTML = `
      <div class="card center">
        <div class="eyebrow">Pre-Screen Required</div>
        <div class="h2">Complete your RentReady pre-screen first.</div>
        <div class="p">Your Game Plan is built from your pre-screen results.</div>
        <a class="btn-primary" href="${RESULTS_URL}">Go To My Pre-Screen <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      </div>`;
    return;
  }

  try { sessionStorage.setItem(PAID10_KEY, '1'); } catch (_e) {}

  if (ent.paid27) {
    try { sessionStorage.setItem(PAID27_KEY, '1'); } catch (_e) {}
    renderUnlocked(answers);
  } else {
    renderLocked(answers);
  }
})();
