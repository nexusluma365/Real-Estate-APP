
const ANSWERS_KEY = 'rrn_answers_v1';
const THANK_YOU_URL = '/thank-you.html';
const START_URL = '/index.html';

// ── PAYMENT CONFIG ─────────────────────────────────────────────
// Real Stripe Subscriptions via the Netlify Functions backend (see
// create-subscription.js) — no card form, uses the payment method saved
// during the $10 pre-screen. The publishable key is the public half of
// your Stripe key pair, safe to expose here.
//
// If the community itself is hosted on Patreon, you can instead point
// PATREON_URL at your Patreon page and flip USE_PATREON to true — the
// buttons will link there instead. Either way, checkout always happens
// on Stripe's or Patreon's own secure infrastructure; this site never
// collects or stores card details.
const STRIPE_PUBLISHABLE_KEY = '';
const USE_PATREON = false;
const PATREON_URL = 'PASTE_YOUR_PATREON_URL_HERE';
// ─────────────────────────────────────────────────────────────

function loadAnswers() {
  try { return JSON.parse(sessionStorage.getItem(ANSWERS_KEY) || 'null'); }
  catch (_e) { return null; }
}

async function handleMembershipPurchase(plan) {
  if (USE_PATREON) {
    if (!PATREON_URL || PATREON_URL.includes('PASTE_YOUR')) {
      alert('Add your Patreon URL to the PATREON_URL constant near the top of membership.html.');
      return;
    }
    window.location.href = PATREON_URL;
    return;
  }

  const btnId = plan === 'yearly' ? 'memBtnYearly' : 'memBtnMonthly';
  const errId = plan === 'yearly' ? 'memErrorYearly' : 'memErrorMonthly';
  const btn = document.getElementById(btnId);
  const errBox = document.getElementById(errId);
  if (btn.dataset.busy === '1') return; // guard against double-click / duplicate charge
  btn.dataset.busy = '1';
  btn.disabled = true;
  errBox.innerHTML = '';
  const originalLabel = btn.innerHTML;
  btn.innerHTML = 'Processing…';

  const stripeKey = await rrnGetStripePublishableKey(STRIPE_PUBLISHABLE_KEY);
  const status = await rrnCreateSubscription(plan, stripeKey);

  if (status === 'succeeded') {
    renderJoined();
    return;
  }

  btn.disabled = false;
  btn.dataset.busy = '0';
  btn.innerHTML = originalLabel;
  errBox.innerHTML = `
    <div class="pay-error">We couldn't complete this purchase with your saved payment method.</div>
    <a class="small-link fade-in" href="#" onclick="continueWithoutMembership(event)">Continue Without This →</a>
  `;
}

function renderJoined() {
  document.getElementById('content').innerHTML = `
    <div class="card center">
      <div class="check-badge"><svg viewBox="0 0 24 24" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></div>
      <div class="eyebrow">Membership Active</div>
      <div class="h1">You're <strong>in.</strong></div>
      <div class="p">Your RentReady Support access information is on its way to your email.</div>
    </div>
  `;
  setTimeout(() => { window.location.href = THANK_YOU_URL; }, 1600);
}

function continueWithoutMembership(evt) {
  if (evt) evt.preventDefault();
  window.location.href = THANK_YOU_URL;
}

(async function boot() {
  const answers = loadAnswers();
  const leadId = answers && answers.lead_id;
  if (!leadId) {
    window.location.replace(START_URL);
    return;
  }
  const ent = await rrnFetchEntitlements(leadId);
  if (!ent || !ent.paid10) {
    window.location.replace(START_URL);
    return;
  }
  if (ent && ent.membershipStatus === 'active') {
    renderJoined();
  }
})();
