/*
 * RentReady funnel tracker — forwards each visitor's steps to the Google
 * Sheets "Funnel" / "Events" tabs (via /.netlify/functions/track-event) so
 * you can see where people stop.
 *
 * Pages don't call this directly: their existing rrTrack() helpers already
 * dispatch a 'rentready:event' window event, and this file listens for it.
 * It also logs a page view on every client-side route change.
 *
 * Payment results (trial started, paid, upsell paid) are NOT sent from
 * here — the server logs those straight from Stripe.
 */
(() => {
const ENDPOINT = '/.netlify/functions/track-event';
const VISITOR_KEY = 'rrn_visitor_id_v1';
const ANSWERS_KEY = 'rrn_answers_v1';

// Page-script events worth a row in the sheet. Everything else that goes
// through rrTrack (agent internals, etc.) stays in the dataLayer only.
const FORWARDED_EVENTS = [
  'intent_landing_view',
  'intent_cta_click',
  'questionnaire_started',
  'questionnaire_completed',
  'checkout_viewed',
  'checkout_submit_attempted',
  'checkout_submitted',
  'card_setup_succeeded',
  'card_setup_failed',
  'subscription_confirmation_started',
  'subscription_confirmation_retried',
  'subscription_confirmation_failed',
  'checkout_payment_failed',
  'results_viewed',
  'upsell_clicked',
  'upsell_declined',
  'upsell_failed',
  'listing_preview_viewed',
  'full_listings_viewed',
  'unlock_listings_clicked',
  'property_contact_clicked',
];

// Pages that have no rrTrack call of their own but mark a funnel step.
const ROUTE_EVENTS = {
  '/results-processing': 'results_processing_viewed',
  '/apartment-approval-preparation-kit': 'upsell_viewed',
};

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : ('v_' + Date.now() + '_' + Math.random().toString(36).slice(2));
}

function visitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = newId();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch (_e) {
    return '';
  }
}

function leadId() {
  try {
    const a = JSON.parse(sessionStorage.getItem(ANSWERS_KEY) || localStorage.getItem(ANSWERS_KEY) || 'null');
    return (a && a.lead_id) || '';
  } catch (_e) {
    return '';
  }
}

function send(event, extra) {
  const vid = visitorId();
  if (!vid) return;
  const body = JSON.stringify(Object.assign({
    event,
    visitor_id: vid,
    lead_id: leadId(),
    page: window.location.pathname + window.location.search,
    occurred_at: new Date().toISOString(),
  }, extra || {}));
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
  } catch (_e) {}
  try {
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch (_e) {}
}

function flatDetail(detail) {
  const out = {};
  Object.keys(detail || {}).forEach((key) => {
    const value = detail[key];
    if (key !== 'event' && value !== undefined && value !== null && value !== '' && typeof value !== 'object') out[key] = value;
  });
  return out;
}

window.addEventListener('rentready:event', (e) => {
  const detail = (e && e.detail) || {};
  const name = detail.event;
  if (name === 'agent_number_one_activity') {
    const activity = detail.agentActivity || {};
    if (activity.type === 'question_presented' && activity.question) {
      send('questionnaire_step', { step: activity.question });
    }
    return;
  }
  if (FORWARDED_EVENTS.indexOf(name) >= 0) {
    send(name, { detail: flatDetail(detail) });
  }
});

let lastPath = null;
function trackRoute() {
  const path = (window.location.pathname || '/').replace(/\.html$/, '').replace(/(.)\/$/, '$1');
  if (path === lastPath) return;
  const isFirstView = lastPath === null;
  lastPath = path;
  const params = new URLSearchParams(window.location.search || '');
  const detail = {};
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((key) => {
    if (params.get(key)) detail[key] = params.get(key);
  });
  if (isFirstView && document.referrer) detail.referrer = document.referrer;
  send('page_view', { step: path, detail });
  if (ROUTE_EVENTS[path]) send(ROUTE_EVENTS[path], { step: path });
}

// Route changes in the SPA happen through history.pushState/replaceState.
['pushState', 'replaceState'].forEach((method) => {
  const original = history[method];
  if (typeof original !== 'function') return;
  history[method] = function () {
    const result = original.apply(this, arguments);
    setTimeout(trackRoute, 0);
    return result;
  };
});
window.addEventListener('popstate', trackRoute);

window.rrnTrack = function rrnTrack(event, detail) {
  try {
    window.dispatchEvent(new CustomEvent('rentready:event', { detail: Object.assign({ event }, detail || {}) }));
  } catch (_e) {}
};

trackRoute();
})();
