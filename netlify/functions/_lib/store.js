// Server-side storage using Netlify Blobs. This is the ONE source of truth
// for what a customer has actually paid for — the frontend never decides
// entitlement on its own, it only asks these stores.
//
// Three logical stores, all backed by Netlify Blobs:
//   "leads"        — the questionnaire answers, saved server-side when
//                     the lead form is submitted and refreshed when the
//                     $10 PaymentIntent is created, so later functions can
//                     trust stored answers instead of browser-sent data.
//   "entitlements" — { paid10, paid27, paid97, membershipStatus,
//                     membershipPlan, stripeCustomerId,
//                     defaultPaymentMethodId, ... } keyed by leadId.
//                     Only stripe-webhook.js and the *-upsell/subscription
//                     functions (after Stripe itself confirms a charge)
//                     are allowed to write here.
//
// Netlify Blobs requires no separate account/setup beyond having the site
// deployed on Netlify — it's provisioned automatically. See SETUP_PAYMENTS.md.
const { getStore } = require('@netlify/blobs');
const fs = require('fs/promises');
const path = require('path');
const { normalizeEmail, isValidEmail } = require('./email');

class LocalBlobStore {
  constructor(name) {
    this.dir = path.join(process.cwd(), '.netlify-local-blobs', name);
  }

  fileFor(key) {
    return path.join(this.dir, encodeURIComponent(key));
  }

  async get(key, opts = {}) {
    try {
      const bytes = await fs.readFile(this.fileFor(key));
      if (opts.type === 'json') {
        return JSON.parse(bytes.toString('utf8'));
      }
      if (opts.type === 'arrayBuffer') {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      return bytes.toString('utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async setJSON(key, value) {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.fileFor(key), JSON.stringify(value, null, 2));
  }
}

function createStore(name) {
  try {
    return getStore(name);
  } catch (err) {
    if (err && err.name === 'MissingBlobsEnvironmentError') {
      return new LocalBlobStore(name);
    }
    throw err;
  }
}

function leadsStore() {
  return createStore('rrn-leads');
}
function entitlementsStore() {
  return createStore('rrn-entitlements');
}
function filesStore() {
  return createStore('rrn-files');
}
function apartmentResultsStore() {
  return createStore('rrn-apartment-results');
}
function waitingListStore() {
  return createStore('rrn-waiting-list');
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return url && key ? { url, key } : null;
}

async function supabaseRequest(path, options = {}) {
  const config = supabaseConfig();
  if (!config) throw new Error('Supabase is not configured.');
  const headers = {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${config.url}/rest/v1/${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${options.method || 'GET'} ${path} failed: ${res.status} ${body}`);
  }
  return res;
}

function leadRecord(leadId, answers = {}) {
  const email = normalizeEmail(answers.email);
  return {
    id: leadId,
    email: isValidEmail(email) ? email : null,
    first_name: answers.first_name || answers.firstName || null,
    last_name: answers.last_name || answers.lastName || null,
    phone: answers.phone || null,
    preferred_city: answers.preferred_city || answers.city || null,
    rent_budget: Number(answers.rent_budget || answers.rentBudget) || null,
    beds_needed: answers.beds_needed || answers.bedrooms || null,
    move_timeline: answers.move_timeline || answers.moveTimeline || null,
    move_reason: answers.move_reason || answers.moveReason || null,
    raw_answers: { ...answers, lead_id: leadId },
    updated_at: new Date().toISOString(),
  };
}

function leadFromRecord(record) {
  if (!record) return null;
  return {
    ...(record.raw_answers || {}),
    lead_id: record.id,
    email: isValidEmail(record.email) ? record.email : '',
    first_name: record.first_name || (record.raw_answers || {}).first_name || '',
    last_name: record.last_name || (record.raw_answers || {}).last_name || '',
    phone: record.phone || (record.raw_answers || {}).phone || '',
    preferred_city: record.preferred_city || (record.raw_answers || {}).preferred_city || '',
    rent_budget: record.rent_budget || (record.raw_answers || {}).rent_budget || '',
    beds_needed: record.beds_needed || (record.raw_answers || {}).beds_needed || '',
    move_timeline: record.move_timeline || (record.raw_answers || {}).move_timeline || '',
    move_reason: record.move_reason || (record.raw_answers || {}).move_reason || '',
  };
}

function defaultEntitlements(leadId) {
  return {
    leadId,
    paid10: false,
    paid27: false,
    paid97: false,
    membershipStatus: 'inactive',
    membershipPlan: null,
    stripeCustomerId: null,
    defaultPaymentMethodId: null,
  };
}

function entitlementRecord(leadId, entitlements = {}) {
  return {
    lead_id: leadId,
    paid10: !!entitlements.paid10,
    paid27: !!entitlements.paid27,
    paid97: !!entitlements.paid97,
    membership_status: entitlements.membershipStatus || 'inactive',
    membership_plan: entitlements.membershipPlan || null,
    purchased_category: entitlements.purchasedCategory || null,
    stripe_customer_id: entitlements.stripeCustomerId || null,
    stripe_payment_intent_id: entitlements.stripePaymentIntentId || null,
    default_payment_method_id: entitlements.defaultPaymentMethodId || null,
    raw_entitlement: { ...entitlements, leadId },
    updated_at: new Date().toISOString(),
  };
}

function entitlementsFromRecord(record, leadId) {
  if (!record) return defaultEntitlements(leadId);
  return {
    ...(record.raw_entitlement || {}),
    leadId,
    paid10: !!record.paid10,
    paid27: !!record.paid27,
    paid97: !!record.paid97,
    membershipStatus: record.membership_status || 'inactive',
    membershipPlan: record.membership_plan || null,
    purchasedCategory: record.purchased_category || null,
    stripeCustomerId: record.stripe_customer_id || null,
    stripePaymentIntentId: record.stripe_payment_intent_id || null,
    defaultPaymentMethodId: record.default_payment_method_id || null,
  };
}

async function saveLead(leadId, answers) {
  if (supabaseConfig()) {
    await supabaseRequest('leads?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(leadRecord(leadId, answers)),
    });
    return;
  }
  await leadsStore().setJSON(leadId, answers);
}

async function getLead(leadId) {
  if (supabaseConfig()) {
    const res = await supabaseRequest(`leads?id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`);
    const rows = await res.json();
    return leadFromRecord(rows[0]);
  }
  return leadsStore().get(leadId, { type: 'json' });
}

async function getEntitlements(leadId) {
  if (supabaseConfig()) {
    const res = await supabaseRequest(`entitlements?lead_id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`);
    const rows = await res.json();
    return entitlementsFromRecord(rows[0], leadId);
  }
  const rec = await entitlementsStore().get(leadId, { type: 'json' });
  return rec || defaultEntitlements(leadId);
}

async function patchEntitlements(leadId, patch) {
  const current = await getEntitlements(leadId);
  const next = { ...current, ...patch, leadId };
  if (supabaseConfig()) {
    if (!(await getLead(leadId))) await saveLead(leadId, { lead_id: leadId });
    await supabaseRequest('entitlements?on_conflict=lead_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(entitlementRecord(leadId, next)),
    });
    return next;
  }
  await entitlementsStore().setJSON(leadId, next);
  return next;
}

async function getProtectedFile(product) {
  // product is 'gameplan' or 'creditkit'. Upload the real PDFs once with
  // the small script documented in SETUP_PAYMENTS.md — this just reads
  // whatever bytes are stored under that key. Nothing here is a public URL.
  return filesStore().get(product, { type: 'arrayBuffer' });
}

async function saveApartmentResults(leadId, category, results) {
  if (supabaseConfig()) {
    if (!(await getLead(leadId))) await saveLead(leadId, { lead_id: leadId });
    await supabaseRequest('apartment_results?on_conflict=lead_id,category', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        lead_id: leadId,
        category,
        provider: results.provider || null,
        criteria_json: results.criteria || {},
        properties_json: Array.isArray(results.properties) ? results.properties : [],
        message: results.message || null,
        raw_result: results,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    return;
  }
  const key = `${leadId}:${category}`;
  await apartmentResultsStore().setJSON(key, {
    leadId,
    category,
    generatedAt: new Date().toISOString(),
    ...results,
  });
}

async function getApartmentResults(leadId, category) {
  if (supabaseConfig()) {
    const res = await supabaseRequest(
      `apartment_results?lead_id=eq.${encodeURIComponent(leadId)}&category=eq.${encodeURIComponent(category)}&select=*&limit=1`
    );
    const rows = await res.json();
    const record = rows[0];
    if (!record) return null;
    return {
      ...(record.raw_result || {}),
      leadId: record.lead_id,
      category: record.category,
      generatedAt: record.generated_at,
      provider: record.provider,
      criteria: record.criteria_json || {},
      properties: record.properties_json || [],
      message: record.message || null,
    };
  }
  return apartmentResultsStore().get(`${leadId}:${category}`, { type: 'json' });
}

async function saveWaitingListEntry(entry) {
  if (supabaseConfig()) {
    const res = await supabaseRequest('waiting_list', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        lead_id: entry.leadId || null,
        category: entry.category || null,
        selected_city: entry.selectedCity || null,
        reason: entry.reason || null,
        raw_entry: entry,
      }),
    });
    const rows = await res.json();
    return String(rows[0]?.id || '');
  }
  const key = `${entry.leadId || 'unknown'}:${entry.category || 'unknown'}:${Date.now()}`;
  await waitingListStore().setJSON(key, entry);
  return key;
}

module.exports = {
  saveLead,
  getLead,
  getEntitlements,
  patchEntitlements,
  getProtectedFile,
  saveApartmentResults,
  getApartmentResults,
  saveWaitingListEntry,
};
