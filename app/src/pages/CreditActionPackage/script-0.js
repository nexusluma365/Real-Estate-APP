
const ANSWERS_KEY = 'rrn_answers_v1';
const PAID27_KEY = 'rrn_paid_27';
const PAID97_KEY = 'rrn_paid_97';
const GAME_PLAN_URL = '/game-plan.html';
const MEMBERSHIP_URL = '/membership.html';

// ── PAYMENT CONFIG ─────────────────────────────────────────────
// Real one-click charge against the card saved during the $10 pre-screen,
// via the Netlify Functions backend (see charge-upsell.js). Netlify serves
// Stripe's publishable key through /.netlify/functions/config.
const STRIPE_PUBLISHABLE_KEY = '';
// ─────────────────────────────────────────────────────────────

function esc(s){ return (s==null?'':String(s)).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function svgCheck(){ return '<svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>'; }

function loadAnswers() {
  try { return JSON.parse(sessionStorage.getItem(ANSWERS_KEY) || 'null'); }
  catch (_e) { return null; }
}

function renderOffer(answers) {
  const first = (answers && answers.first_name) || 'there';
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="eyebrow">One Part Of Your Game Plan Deserves A Closer Look</div>
      <div class="h1">${esc(first)}, know exactly how to handle what's on your reports.</div>
      <div class="p">Your answers suggest that information appearing in your credit or rental history may be one of the areas worth reviewing before you apply.</div>
      <div class="p" style="margin-top:8px;">If something being reported is inaccurate, incomplete, or cannot be properly verified, knowing how to review and challenge that information can help you take the right next step.</div>
    </div>

    <div class="card">
      <div class="h2">RentReady Credit Action Kit</div>
      <div class="p">Go from knowing credit may be an issue to knowing exactly how to review and address legitimate reporting problems.</div>
      <div class="contents">
        <div class="c-row">${svgCheck()}<span>Step-by-step credit report review process</span></div>
        <div class="c-row">${svgCheck()}<span>Guided workflow for identifying potentially inaccurate or incomplete information</span></div>
        <div class="c-row">${svgCheck()}<span>Ready-to-customize dispute templates for legitimate disputes</span></div>
        <div class="c-row">${svgCheck()}<span>Collection response templates</span></div>
        <div class="c-row">${svgCheck()}<span>Previous-landlord debt verification templates</span></div>
        <div class="c-row">${svgCheck()}<span>Documentation checklist</span></div>
        <div class="c-row">${svgCheck()}<span>Mailing/submission guidance</span></div>
        <div class="c-row">${svgCheck()}<span>Response tracker</span></div>
        <div class="c-row">${svgCheck()}<span>Follow-up decision guide</span></div>
        <div class="c-row">${svgCheck()}<span>CFPB escalation guidance when appropriate</span></div>
        <div class="c-row">${svgCheck()}<span>Clear instructions for what to do when responses arrive</span></div>
      </div>
    </div>

    <div class="card">
      <div class="h2">Know what to do when something on your reports doesn't look right.</div>
      <div class="flow">
        <div class="flow-item"><div class="flow-num">1</div><div><div class="flow-t">Review your reports</div><div class="flow-p">Work through the guided checklist to see what's actually being reported.</div></div></div>
        <div class="flow-item"><div class="flow-num">2</div><div><div class="flow-t">Flag what looks wrong</div><div class="flow-p">Identify items that are inaccurate, incomplete, or unverifiable.</div></div></div>
        <div class="flow-item"><div class="flow-num">3</div><div><div class="flow-t">Customize the right template</div><div class="flow-p">Use the matching template for a dispute, a collection response, or a landlord-debt verification request.</div></div></div>
        <div class="flow-item"><div class="flow-num">4</div><div><div class="flow-t">Send and track it</div><div class="flow-p">Follow the mailing guidance and log it in the response tracker.</div></div></div>
        <div class="flow-item"><div class="flow-num">5</div><div><div class="flow-t">Decide what's next</div><div class="flow-p">Use the follow-up guide when a response arrives — or when one doesn't.</div></div></div>
      </div>
    </div>

    <div class="card">
      <div class="pay-box">
        <div class="pay-label">RentReady Credit Action Kit</div>
        <div class="pay-price">$97 <span>one-time</span></div>
        <button class="btn-primary" id="ckBuyBtn" onclick="handleCreditKitPurchase()">Add The Credit Action Kit <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        <div class="microcopy">One-time $97 · One-click purchase</div>
        <div id="ckError"></div>
      </div>
      <a class="small-link" href="${MEMBERSHIP_URL}">Continue with my current game plan</a>
      <div class="disclosure">This kit provides a guided review process and letter templates to help you organize legitimate credit and rental-history disputes. It does not guarantee score increases, account deletions, or rental approval, is not a credit repair or legal service, and never encourages disputing accurate information.</div>
    </div>
  `;
}

async function handleCreditKitPurchase() {
  const btn = document.getElementById('ckBuyBtn');
  const errBox = document.getElementById('ckError');
  if (btn.dataset.busy === '1') return; // guard against double-click / duplicate charge
  btn.dataset.busy = '1';
  btn.disabled = true;
  errBox.innerHTML = '';
  const originalLabel = btn.innerHTML;
  btn.innerHTML = 'Processing…';

  const stripeKey = await rrnGetStripePublishableKey(STRIPE_PUBLISHABLE_KEY);
  const status = await rrnChargeUpsell('creditkit', stripeKey);

  if (status === 'succeeded') {
    try { sessionStorage.setItem(PAID97_KEY, '1'); } catch (_e) {}
    renderUnlocked(loadAnswers());
    return;
  }

  if (status === 'processing') {
    btn.innerHTML = 'Confirming your payment…';
    pollForCreditKitCompletion(btn, originalLabel, errBox);
    return;
  }

  btn.disabled = false;
  btn.dataset.busy = '0';
  btn.innerHTML = originalLabel;
  errBox.innerHTML = `
    <div class="pay-error">We couldn't complete this purchase with your saved payment method.</div>
    <a class="small-link fade-in" href="#" onclick="skipCreditKit(event)">Continue Without This →</a>
  `;
}

function pollForCreditKitCompletion(btn, originalLabel, errBox) {
  const leadId = rrnLeadId();
  let attempts = 0;
  const check = async () => {
    attempts++;
    const ent = await rrnFetchEntitlements(leadId);
    if (ent && ent.paid97) {
      try { sessionStorage.setItem(PAID97_KEY, '1'); } catch (_e) {}
      renderUnlocked(loadAnswers());
      return;
    }
    if (attempts >= 6) {
      btn.disabled = false;
      btn.dataset.busy = '0';
      btn.innerHTML = originalLabel;
      errBox.innerHTML = `
        <div class="pay-error">Your payment is still processing. It's safe to check back shortly.</div>
        <a class="small-link fade-in" href="#" onclick="skipCreditKit(event)">Continue Without This →</a>
      `;
      return;
    }
    setTimeout(check, 2000);
  };
  setTimeout(check, 2000);
}

function skipCreditKit(evt) {
  if (evt) evt.preventDefault();
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="eyebrow">Continuing Without The Credit Action Kit</div>
      <div class="h2">No problem — you can pick this up again any time.</div>
      <div class="p">Your Game Plan is still yours. Here's what's next.</div>
      <a class="btn-secondary" href="${MEMBERSHIP_URL}">See RentReady Support →</a>
      <a class="small-link" href="${GAME_PLAN_URL}">Back to my Game Plan</a>
    </div>
  `;
}

function renderUnlocked(answers) {
  const first = (answers && answers.first_name) || 'there';
  document.getElementById('content').innerHTML = `
    <div class="card center">
      <div class="eyebrow">Kit Unlocked</div>
      <div class="h1">${esc(first)}, your Credit Action Kit is ready.</div>
      <div class="p">Here's exactly where to begin.</div>
    </div>

    <div class="card">
      <div class="h2">Start Here</div>
      <div class="step-item"><div class="step-num">1</div><div><div class="step-t">Pull your three credit reports</div><div class="step-p">Use the guided checklist to work through each one section by section.</div></div></div>
      <div class="step-item"><div class="step-num">2</div><div><div class="step-t">Flag anything worth a closer look</div><div class="step-p">Use the identification workflow to separate real issues from things that are simply unfamiliar at a glance.</div></div></div>
      <div class="step-item"><div class="step-num">3</div><div><div class="step-t">Open the matching template</div><div class="step-p">Customize it with your information and the specifics of what you're disputing, then follow the mailing guidance.</div></div></div>
    </div>

    <div class="card">
      <div class="h2">Your Credit Action Kit Is Ready</div>
      <div class="p">Download it any time, or we can send a copy to your email.</div>
      <a class="btn-secondary" href="${rrnDownloadUrl('creditkit')}">Download My Credit Action Kit</a>
      <button class="btn-secondary" id="ckEmailBtn" onclick="handleEmailCreditKit()" style="cursor:pointer;">Email My Credit Action Kit</button>
    </div>

    <div class="card">
      <div class="eyebrow">You Don't Have To Figure Out Every Next Step Alone</div>
      <div class="h2">Responses take time. Questions come up along the way.</div>
      <div class="p">RentReady Support gives you a place to keep moving forward as documents change and responses arrive.</div>
      <a class="btn-primary" href="${MEMBERSHIP_URL}">See RentReady Support <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
    </div>
  `;
}

async function handleEmailCreditKit() {
  const btn = document.getElementById('ckEmailBtn');
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = 'Sending…';
  btn.disabled = true;
  const ok = await rrnEmailAsset('creditkit');
  btn.textContent = ok ? 'Sent ✓' : 'Could Not Send — Try Again';
  btn.disabled = ok;
}

(async function boot() {
  const answers = loadAnswers();
  if (!answers) {
    document.getElementById('content').innerHTML = `
      <div class="card center">
        <div class="eyebrow">Pre-Screen Required</div>
        <div class="h2">Complete your RentReady pre-screen first.</div>
        <a class="btn-primary" href="/after-payment-results/">Go To My Pre-Screen <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      </div>`;
    return;
  }

  const ent = await rrnFetchEntitlements(answers.lead_id);

  if (!ent || !ent.paid27) {
    document.getElementById('content').innerHTML = `
      <div class="card center">
        <div class="eyebrow">Game Plan Required</div>
        <div class="h2">Complete your RentReady Game Plan first.</div>
        <a class="btn-primary" href="${GAME_PLAN_URL}">Go To My Game Plan <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>
      </div>`;
    return;
  }

  if (ent.paid97) {
    try { sessionStorage.setItem(PAID97_KEY, '1'); } catch (_e) {}
    renderUnlocked(answers);
  } else {
    renderOffer(answers);
  }
})();
