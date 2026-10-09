/*
 * RentReady checkout client — shared by every page AFTER the $10
 * pre-screen (game-plan.html, credit-action-package.html, membership.html).
 * The $10 page itself uses Stripe's Payment Element directly (it's the
 * only place a card is ever typed), which is wired inline in
 * the result pages rather than here.
 *
 * This file does not render or style anything — it only calls the
 * Netlify Functions backend and reports back a small set of states so
 * each page's own markup (already styled to match the rest of the site)
 * can react to them.
 */
(() => {
const ANSWERS_KEY = 'rrn_answers_v1';
const FLOW_ACCESS_KEY = 'rrn_flow_access_v1';
const PRESCREEN_INTENT_KEY = 'rrn_prescreen_payment_intent_v1';
const APARTMENT_INTENT_KEY = 'rrn_apartment_payment_intent_v1';
const FLOW_ACCESS_TTL_MS = 20 * 60 * 1000;
let rrnConfigPromise = null;
const PAYMENT_OVERLAY_ID = 'rrnPaymentOverlay';
const PAYMENT_OVERLAY_STYLE_ID = 'rrnPaymentOverlayStyles';

function rrnLeadId() {
  try {
    const a = JSON.parse(sessionStorage.getItem(ANSWERS_KEY) || localStorage.getItem(ANSWERS_KEY) || 'null');
    return (a && a.lead_id) || null;
  } catch (_e) {
    return null;
  }
}

function rrnFlowAccess() {
  try { return JSON.parse(sessionStorage.getItem(FLOW_ACCESS_KEY) || 'null'); }
  catch (_e) { return null; }
}

function rrnGrantFlowAccess(step, details) {
  try {
    sessionStorage.setItem(FLOW_ACCESS_KEY, JSON.stringify({
      step,
      status: details && details.status ? details.status : 'confirmed',
      category: details && details.category ? details.category : null,
      city: details && details.city ? details.city : null,
      at: Date.now(),
    }));
  } catch (_e) {}
}

function rrnHasRecentFlowAccess(step, options) {
  const access = rrnFlowAccess();
  if (!access || access.step !== step) return false;
  if (!access.at || Date.now() - access.at > FLOW_ACCESS_TTL_MS) return false;
  if (options && options.statuses && !options.statuses.includes(access.status)) return false;
  if (options && options.category && access.category !== options.category) return false;
  return true;
}

function rrnNewIdempotencyKey() {
  return (crypto.randomUUID ? crypto.randomUUID() : ('k_' + Date.now() + '_' + Math.random().toString(36).slice(2)));
}

function rrnPrescreenPaymentIntentId() {
  try {
    return sessionStorage.getItem(PRESCREEN_INTENT_KEY) || localStorage.getItem(PRESCREEN_INTENT_KEY) || null;
  } catch (_e) {
    return null;
  }
}

function rrnRememberApartmentPaymentIntent(product, paymentIntentId) {
  if (!product || !paymentIntentId) return;
  try {
    const current = JSON.parse(sessionStorage.getItem(APARTMENT_INTENT_KEY) || localStorage.getItem(APARTMENT_INTENT_KEY) || '{}') || {};
    current[product] = paymentIntentId;
    sessionStorage.setItem(APARTMENT_INTENT_KEY, JSON.stringify(current));
    localStorage.setItem(APARTMENT_INTENT_KEY, JSON.stringify(current));
  } catch (_e) {}
}

function rrnApartmentPaymentIntentId(product) {
  try {
    const current = JSON.parse(sessionStorage.getItem(APARTMENT_INTENT_KEY) || localStorage.getItem(APARTMENT_INTENT_KEY) || '{}') || {};
    return current[product] || null;
  } catch (_e) {
    return null;
  }
}

let rrnStripeJsPromise = null;
const STRIPE_JS_URL = 'https://js.stripe.com/v3/';
const STRIPE_JS_TIMEOUT_MS = 15000;

// Stripe.js is loaded with `async` in index.html so it never blocks the
// page from painting. Callers await this instead of reading window.Stripe
// directly: it reuses the in-flight <script> tag (no duplicate download),
// retries once with a fresh tag if that one failed, and times out cleanly.
function rrnLoadStripeJs() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (rrnStripeJsPromise) return rrnStripeJsPromise;
  rrnStripeJsPromise = new Promise((resolve, reject) => {
    let settled = false;
    let poll = null;
    let timer = null;
    const finish = (ok, err) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      if (ok && window.Stripe) resolve(window.Stripe);
      else {
        rrnStripeJsPromise = null;
        reject(err || new Error('Stripe did not load. Refresh the page and try again.'));
      }
    };
    const inject = () => {
      const s = document.createElement('script');
      s.src = STRIPE_JS_URL;
      s.async = true;
      s.onload = () => finish(true);
      s.onerror = () => finish(false);
      document.head.appendChild(s);
    };
    const existing = document.querySelector('script[src^="https://js.stripe.com/v3"]');
    if (existing) {
      existing.addEventListener('load', () => finish(true), { once: true });
      existing.addEventListener('error', inject, { once: true });
    } else {
      inject();
    }
    // Covers the case where the existing tag already finished loading
    // before we attached listeners.
    poll = setInterval(() => { if (window.Stripe) finish(true); }, 100);
    timer = setTimeout(() => finish(false), STRIPE_JS_TIMEOUT_MS);
  });
  return rrnStripeJsPromise;
}

async function rrnGetConfig() {
  if (!rrnConfigPromise) {
    rrnConfigPromise = fetch('/.netlify/functions/config')
      .then((res) => res.ok ? res.json() : null)
      .catch(() => null);
  }
  return await rrnConfigPromise;
}

async function rrnGetStripePublishableKey(fallbackPublishableKey = '') {
  const config = await rrnGetConfig();
  if (config && config.stripePublishableKey) return config.stripePublishableKey;
  if (fallbackPublishableKey) return fallbackPublishableKey;
  console.error('Stripe publishable key unavailable from config', config && config.error);
  return '';
}

async function rrnFetchEntitlements(leadId) {
  const res = await fetch('/.netlify/functions/get-entitlements?leadId=' + encodeURIComponent(leadId));
  if (!res.ok) return null;
  const data = await res.json();
  return data.ok ? data : null;
}

/**
 * Runs the full one-click purchase for an optional upsell product, including
 * transparently handling a bank's 3-D Secure challenge if Stripe requires
 * one. Resolves to one of: 'succeeded' | 'failed' | 'processing'.
 */
async function rrnChargeUpsell(product, publishableKey) {
  const leadId = rrnLeadId();
  if (!leadId) return 'failed';

  const idempotencyKey = rrnNewIdempotencyKey();
  const res = await fetch('/.netlify/functions/charge-upsell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, product, idempotencyKey, prescreenPaymentIntentId: rrnPrescreenPaymentIntentId() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data || !data.ok) return 'failed';

  if (data.status === 'requires_action') {
    const stripeKey = await rrnGetStripePublishableKey(publishableKey);
    return await rrnHandleAction(data.clientSecret, leadId, product, stripeKey);
  }
  if ((data.status === 'succeeded' || data.status === 'processing') && data.paymentIntentId) {
    rrnRememberApartmentPaymentIntent(product, data.paymentIntentId);
  }
  return data.status; // 'succeeded' | 'failed' | 'processing'
}

/**
 * Same idea as rrnChargeUpsell, for the RentReady Support subscription.
 */
async function rrnCreateSubscription(plan, publishableKey) {
  const leadId = rrnLeadId();
  if (!leadId) return 'failed';

  const idempotencyKey = rrnNewIdempotencyKey();
  const res = await fetch('/.netlify/functions/create-subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, plan, idempotencyKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data || !data.ok) return 'failed';

  if (data.status === 'requires_action') {
    const Stripe = await rrnLoadStripeJs();
    const stripeKey = await rrnGetStripePublishableKey(publishableKey);
    const stripe = Stripe(stripeKey);
    const result = await stripe.confirmCardPayment(data.clientSecret);
    if (result.error) return 'failed';
    const confirmRes = await fetch('/.netlify/functions/confirm-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, subscriptionId: data.subscriptionId, plan }),
    });
    const confirmData = await confirmRes.json().catch(() => ({}));
    return confirmData && confirmData.ok ? confirmData.status : 'failed';
  }
  return data.status;
}

async function rrnHandleAction(clientSecret, leadId, product, publishableKey) {
  const Stripe = await rrnLoadStripeJs();
  const stripe = Stripe(publishableKey);
  const result = await stripe.confirmCardPayment(clientSecret);
  if (result.error) return 'failed';

  const stripeSucceeded = result.paymentIntent && result.paymentIntent.status === 'succeeded';
  if (stripeSucceeded) rrnRememberApartmentPaymentIntent(product, result.paymentIntent.id);
  try {
    const confirmRes = await fetch('/.netlify/functions/confirm-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId, paymentIntentId: result.paymentIntent.id, product }),
    });
    const confirmData = await confirmRes.json().catch(() => ({}));
    return confirmData && confirmData.ok ? confirmData.status : 'failed';
  } catch (_e) {
    return 'failed';
  }
}

function rrnDownloadUrl(product) {
  const leadId = rrnLeadId();
  return '/.netlify/functions/download-file?leadId=' + encodeURIComponent(leadId) + '&product=' + encodeURIComponent(product);
}

function rrnEnsurePaymentOverlay() {
  if (!document.getElementById(PAYMENT_OVERLAY_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = PAYMENT_OVERLAY_STYLE_ID;
    style.textContent = `
      #${PAYMENT_OVERLAY_ID}{
        position:fixed;
        inset:0;
        z-index:99999;
        display:none;
        align-items:center;
        justify-content:center;
        padding:24px;
        background:rgba(20,31,25,.48);
        backdrop-filter:blur(10px) saturate(115%);
        -webkit-backdrop-filter:blur(10px) saturate(115%);
      }
      #${PAYMENT_OVERLAY_ID}.is-open{display:flex}
      #${PAYMENT_OVERLAY_ID} .rrn-payment-card{
        width:min(420px,100%);
        border-radius:26px;
        background:#fff;
        padding:38px 32px;
        text-align:center;
        box-shadow:0 25px 60px rgba(0,0,0,.25);
        color:#17231c;
        font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",Arial,sans-serif;
      }
      #${PAYMENT_OVERLAY_ID} .rrn-payment-icon{
        width:54px;
        height:54px;
        margin:0 auto 20px;
        border-radius:50%;
        border:4px solid rgba(52,72,61,.16);
        border-top-color:#34483d;
        animation:rrnPaymentSpin .75s linear infinite;
      }
      #${PAYMENT_OVERLAY_ID}.is-success .rrn-payment-icon{
        display:grid;
        place-items:center;
        border:0;
        background:#34483d;
        color:#fff;
        font-size:30px;
        font-weight:800;
        animation:none;
      }
      #${PAYMENT_OVERLAY_ID}.is-success .rrn-payment-icon:before{content:"✓"}
      #${PAYMENT_OVERLAY_ID} h4{
        margin:0 0 10px;
        color:#17231c;
        font-size:28px;
        font-weight:800;
        line-height:1.1;
        letter-spacing:0;
      }
      #${PAYMENT_OVERLAY_ID} p{
        margin:0;
        color:#5f6f65;
        font-size:15px;
        line-height:1.55;
      }
      @keyframes rrnPaymentSpin{to{transform:rotate(360deg)}}
    `;
    document.head.appendChild(style);
  }

  let overlay = document.getElementById(PAYMENT_OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = PAYMENT_OVERLAY_ID;
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <div class="rrn-payment-card">
        <div class="rrn-payment-icon" aria-hidden="true"></div>
        <h4>Processing your payment</h4>
        <p>Please wait while we securely confirm your purchase.</p>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  return overlay;
}

function rrnShowPaymentOverlay(options) {
  const overlay = rrnEnsurePaymentOverlay();
  const opts = options || {};
  const state = opts.state || 'processing';
  const title = opts.title || (state === 'success' ? 'Thank You' : 'Processing your payment');
  const message = opts.message || (state === 'success'
    ? 'Your payment was successful. Taking you to the next step now.'
    : 'Please wait while we securely confirm your purchase.');
  const titleEl = overlay.querySelector('h4');
  const messageEl = overlay.querySelector('p');
  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;
  overlay.classList.remove('is-success');
  if (state === 'success') overlay.classList.add('is-success');
  overlay.classList.add('is-open');
}

function rrnHidePaymentOverlay() {
  const overlay = document.getElementById(PAYMENT_OVERLAY_ID);
  if (overlay) overlay.classList.remove('is-open', 'is-success');
}

async function rrnEmailAsset(type, category) {
  const leadId = rrnLeadId();
  if (!leadId) return false;
  const res = await fetch('/.netlify/functions/email-asset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leadId, type, category }),
  });
  const data = await res.json().catch(() => ({}));
  return !!(data && data.ok);
}

window.rrnLeadId = rrnLeadId;
window.rrnNewIdempotencyKey = rrnNewIdempotencyKey;
window.rrnPrescreenPaymentIntentId = rrnPrescreenPaymentIntentId;
window.rrnApartmentPaymentIntentId = rrnApartmentPaymentIntentId;
window.rrnLoadStripeJs = rrnLoadStripeJs;
window.rrnGetConfig = rrnGetConfig;
window.rrnGetStripePublishableKey = rrnGetStripePublishableKey;
window.rrnFetchEntitlements = rrnFetchEntitlements;
window.rrnChargeUpsell = rrnChargeUpsell;
window.rrnCreateSubscription = rrnCreateSubscription;
window.rrnDownloadUrl = rrnDownloadUrl;
window.rrnEmailAsset = rrnEmailAsset;
window.rrnGrantFlowAccess = rrnGrantFlowAccess;
window.rrnHasRecentFlowAccess = rrnHasRecentFlowAccess;
window.rrnShowPaymentOverlay = rrnShowPaymentOverlay;
window.rrnHidePaymentOverlay = rrnHidePaymentOverlay;
})();
