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
const { normalizeManyChatContactId } = require('./manychat');
const { normalizeAgentLead } = require('./agent-number-one');

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
function propertyImageCacheStore() {
  return createStore('rrn-property-image-cache');
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
  const manychatContactId = normalizeManyChatContactId(answers.manychat_contact_id || answers.manychatContactId);
  const agent = normalizeAgentLead(answers);
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
    manychat_contact_id: manychatContactId || null,
    agent_status: agent.agent_status,
    agent_intent: agent.agent_intent,
    agent_state: agent.agent_state,
    agent_activity: agent.agent_activity,
    raw_answers: { ...answers, lead_id: leadId, ...(manychatContactId ? { manychat_contact_id: manychatContactId } : {}), ...agent },
    updated_at: new Date().toISOString(),
  };
}

function leadFromRecord(record) {
  if (!record) return null;
  const agent = normalizeAgentLead({
    ...(record.raw_answers || {}),
    agent_status: record.agent_status || (record.raw_answers || {}).agent_status,
    agent_intent: record.agent_intent || (record.raw_answers || {}).agent_intent,
    agent_state: record.agent_state || (record.raw_answers || {}).agent_state,
    agent_activity: record.agent_activity || (record.raw_answers || {}).agent_activity,
  });
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
    manychat_contact_id: normalizeManyChatContactId(record.manychat_contact_id || (record.raw_answers || {}).manychat_contact_id),
    agent_status: agent.agent_status,
    agent_intent: agent.agent_intent,
    agent_state: agent.agent_state,
    agent_activity: agent.agent_activity,
  };
}

function agentHandoffStatus(lead = {}) {
  const handoff = lead.agent_state && lead.agent_state.handoff && typeof lead.agent_state.handoff === 'object'
    ? lead.agent_state.handoff
    : {};
  return String(handoff.agent_1_status || handoff.agent1_status || '').trim();
}

function mergeAgentHandoffState(answers = {}, existingLead = null) {
  if (!existingLead) return answers;
  const existingHandoff = existingLead.agent_state && existingLead.agent_state.handoff && typeof existingLead.agent_state.handoff === 'object'
    ? existingLead.agent_state.handoff
    : {};
  const incomingState = answers.agent_state && typeof answers.agent_state === 'object' ? answers.agent_state : {};
  const incomingHandoff = incomingState.handoff && typeof incomingState.handoff === 'object' ? incomingState.handoff : {};
  if (incomingHandoff.agent_1_status || incomingHandoff.agent1_status) return answers;

  const currentStatus = agentHandoffStatus(existingLead);
  if (!currentStatus || !['processing', 'completed'].includes(currentStatus)) return answers;

  return {
    ...answers,
    agent_state: {
      ...incomingState,
      handoff: {
        ...incomingHandoff,
        agent_1_status: existingHandoff.agent_1_status || currentStatus,
        agent_1_started_at: existingHandoff.agent_1_started_at,
        agent_1_completed_at: existingHandoff.agent_1_completed_at,
        agent_1_failed_at: existingHandoff.agent_1_failed_at,
        agent_1_failure: existingHandoff.agent_1_failure,
      },
    },
  };
}

function leadWithHandoffPatch(lead = {}, patch = {}) {
  const state = lead.agent_state && typeof lead.agent_state === 'object' ? lead.agent_state : {};
  const handoff = state.handoff && typeof state.handoff === 'object' ? state.handoff : {};
  return {
    ...lead,
    agent_state: {
      ...state,
      handoff: {
        ...handoff,
        ...patch,
      },
    },
  };
}

async function supabaseRpc(functionName, body) {
  const res = await supabaseRequest(`rpc/${functionName}`, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(body),
  });
  return res.json();
}

function normalizeAgentHandoffRpcResult(result) {
  if (!result || typeof result !== 'object' || !result.lead) return result;
  return { ...result, lead: leadFromRecord(result.lead) || result.lead };
}

function defaultEntitlements(leadId) {
  return {
    leadId,
    paid10: false,
    paid27: false,
    paid97: false,
    membershipStatus: 'inactive',
    membershipPlan: null,
    purchasedCategory: null,
    purchasedCategories: [],
    stripeCustomerId: null,
    defaultPaymentMethodId: null,
    manychat_contact_id: null,
    manychatContactId: null,
  };
}

// A customer can buy apartment matches ($27) for more than one category
// (modern, then later luxury, or vice versa). `purchasedCategories` is the
// source of truth for which ones they own; `purchasedCategory` (singular)
// is kept in sync as "most recently purchased" only so the legacy frontend
// pages — which still compare against a single category — keep working
// unchanged for the common single-purchase case.
function mostRecentCategory(purchasedCategories, fallback) {
  return purchasedCategories[purchasedCategories.length - 1] || fallback || null;
}

function entitlementRecord(leadId, entitlements = {}) {
  const purchasedCategories = Array.isArray(entitlements.purchasedCategories) ? entitlements.purchasedCategories : [];
  const manychatContactId = normalizeManyChatContactId(entitlements.manychat_contact_id || entitlements.manychatContactId);
  return {
    lead_id: leadId,
    paid10: !!entitlements.paid10,
    paid27: !!entitlements.paid27,
    paid97: !!entitlements.paid97,
    membership_status: entitlements.membershipStatus || 'inactive',
    membership_plan: entitlements.membershipPlan || null,
    purchased_category: mostRecentCategory(purchasedCategories, entitlements.purchasedCategory),
    stripe_customer_id: entitlements.stripeCustomerId || null,
    stripe_payment_intent_id: entitlements.stripePaymentIntentId || null,
    default_payment_method_id: entitlements.defaultPaymentMethodId || null,
    manychat_contact_id: manychatContactId || null,
    raw_entitlement: { ...entitlements, leadId, purchasedCategories, ...(manychatContactId ? { manychat_contact_id: manychatContactId, manychatContactId } : {}) },
    updated_at: new Date().toISOString(),
  };
}

function entitlementsFromRecord(record, leadId) {
  if (!record) return defaultEntitlements(leadId);
  const rawCategories = record.raw_entitlement && Array.isArray(record.raw_entitlement.purchasedCategories)
    ? record.raw_entitlement.purchasedCategories
    : [];
  const purchasedCategories = rawCategories.length
    ? rawCategories
    : record.purchased_category
    ? [record.purchased_category]
    : [];
  const manychatContactId = normalizeManyChatContactId(
    record.manychat_contact_id ||
    (record.raw_entitlement || {}).manychat_contact_id ||
    (record.raw_entitlement || {}).manychatContactId
  );
  return {
    ...(record.raw_entitlement || {}),
    leadId,
    paid10: !!record.paid10,
    paid27: !!record.paid27,
    paid97: !!record.paid97,
    membershipStatus: record.membership_status || 'inactive',
    membershipPlan: record.membership_plan || null,
    purchasedCategory: mostRecentCategory(purchasedCategories, record.purchased_category),
    purchasedCategories,
    stripeCustomerId: record.stripe_customer_id || null,
    stripePaymentIntentId: record.stripe_payment_intent_id || null,
    defaultPaymentMethodId: record.default_payment_method_id || null,
    manychat_contact_id: manychatContactId || null,
    manychatContactId: manychatContactId || null,
  };
}

function normalizeLocalEntitlements(rec, leadId) {
  if (!rec) return defaultEntitlements(leadId);
  const purchasedCategories =
    Array.isArray(rec.purchasedCategories) && rec.purchasedCategories.length
      ? rec.purchasedCategories
      : rec.purchasedCategory
      ? [rec.purchasedCategory]
      : [];
  const manychatContactId = normalizeManyChatContactId(rec.manychat_contact_id || rec.manychatContactId);
  return {
    ...rec,
    purchasedCategories,
    purchasedCategory: mostRecentCategory(purchasedCategories, rec.purchasedCategory),
    manychat_contact_id: manychatContactId || null,
    manychatContactId: manychatContactId || null,
  };
}

async function saveLead(leadId, answers) {
  let answersToSave = answers;
  const existingLead = await getLead(leadId).catch(() => null);
  answersToSave = mergeAgentHandoffState(answers, existingLead);
  if (supabaseConfig()) {
    await supabaseRequest('leads?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(leadRecord(leadId, answersToSave)),
    });
    return;
  }
  const normalizedEmail = normalizeEmail(answersToSave && answersToSave.email);
  const normalizedAnswers = { ...answersToSave, ...(isValidEmail(normalizedEmail) ? { email: normalizedEmail } : {}) };
  await leadsStore().setJSON(leadId, normalizedAnswers);
  if (isValidEmail(normalizedEmail)) {
    await leadsStore().setJSON(`email:${encodeURIComponent(normalizedEmail)}`, {
      leadId,
      updated_at: new Date().toISOString(),
    });
  }
}

async function getLead(leadId) {
  if (supabaseConfig()) {
    const res = await supabaseRequest(`leads?id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`);
    const rows = await res.json();
    return leadFromRecord(rows[0]);
  }
  return leadsStore().get(leadId, { type: 'json' });
}

async function getLeadByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) return null;
  if (supabaseConfig()) {
    const res = await supabaseRequest(`leads?email=eq.${encodeURIComponent(normalizedEmail)}&select=*&order=updated_at.desc&limit=1`);
    const rows = await res.json();
    return leadFromRecord(rows[0]);
  }
  const index = await leadsStore().get(`email:${encodeURIComponent(normalizedEmail)}`, { type: 'json' });
  if (!index || !index.leadId) return null;
  return getLead(index.leadId);
}

async function claimAgentHandoff(leadId) {
  if (supabaseConfig()) {
    try {
      return normalizeAgentHandoffRpcResult(await supabaseRpc('claim_agent1_handoff', { p_lead_id: leadId }));
    } catch (err) {
      console.error('[Agent1 Handoff] Atomic Supabase claim failed; falling back to read/write guard', err);
    }
  }
  const lead = await getLead(leadId);
  if (!lead) return { claimed: false, reason: 'lead_not_found' };
  const status = agentHandoffStatus(lead);
  if (status === 'processing') return { claimed: false, reason: 'agent_1_already_processing', lead };
  if (status === 'completed') return { claimed: false, reason: 'agent_1_already_completed', lead };

  const next = leadWithHandoffPatch(lead, {
    agent_1_status: 'processing',
    agent_1_started_at: new Date().toISOString(),
    agent_1_completed_at: null,
    agent_1_failed_at: null,
    agent_1_failure: null,
  });
  await saveLead(leadId, next);
  return { claimed: true, reason: 'agent_1_claimed', lead: next };
}

async function markAgentHandoffComplete(leadId) {
  if (supabaseConfig()) {
    try {
      return normalizeAgentHandoffRpcResult(await supabaseRpc('complete_agent1_handoff', { p_lead_id: leadId }));
    } catch (err) {
      console.error('[Agent1 Handoff] Supabase completion mark failed; falling back to read/write update', err);
    }
  }
  const lead = await getLead(leadId);
  if (!lead) return null;
  const next = leadWithHandoffPatch(lead, {
    agent_1_status: 'completed',
    agent_1_completed_at: new Date().toISOString(),
    agent_1_failure: null,
  });
  await saveLead(leadId, next);
  return next;
}

async function markAgentHandoffFailed(leadId, error) {
  if (supabaseConfig()) {
    try {
      return normalizeAgentHandoffRpcResult(await supabaseRpc('fail_agent1_handoff', {
        p_lead_id: leadId,
        p_error: String(error || '').slice(0, 1000),
      }));
    } catch (err) {
      console.error('[Agent1 Handoff] Supabase failure mark failed; falling back to read/write update', err);
    }
  }
  const lead = await getLead(leadId);
  if (!lead) return null;
  const next = leadWithHandoffPatch(lead, {
    agent_1_status: 'failed',
    agent_1_failed_at: new Date().toISOString(),
    agent_1_failure: String(error || '').slice(0, 1000),
  });
  await saveLead(leadId, next);
  return next;
}

async function getEntitlements(leadId) {
  if (supabaseConfig()) {
    const res = await supabaseRequest(`entitlements?lead_id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`);
    const rows = await res.json();
    return entitlementsFromRecord(rows[0], leadId);
  }
  const rec = await entitlementsStore().get(leadId, { type: 'json' });
  return normalizeLocalEntitlements(rec, leadId);
}

async function patchEntitlements(leadId, patch) {
  const current = await getEntitlements(leadId);
  const { addPurchasedCategory, ...rest } = patch;
  const purchasedCategories = addPurchasedCategory
    ? Array.from(new Set([...(current.purchasedCategories || []), addPurchasedCategory]))
    : current.purchasedCategories || [];
  const next = {
    ...current,
    ...rest,
    purchasedCategories,
    purchasedCategory: mostRecentCategory(purchasedCategories, current.purchasedCategory),
    leadId,
  };
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

function imageCacheFromRecord(record) {
  if (!record) return null;
  const raw = record.raw_cache && typeof record.raw_cache === 'object' ? record.raw_cache : {};
  return {
    ...raw,
    cacheKey: record.id || raw.cacheKey,
    propertyId: record.property_id || raw.propertyId || '',
    propertyName: record.property_name || raw.propertyName || '',
    propertyAddress: record.property_address || raw.propertyAddress || '',
    officialWebsite: record.official_website || raw.officialWebsite || '',
    imageUrl: record.image_url || raw.imageUrl || '',
    sourcePageUrl: record.source_page_url || raw.sourcePageUrl || '',
    sourceDomain: record.source_domain || raw.sourceDomain || '',
    sourceType: record.source_type || raw.sourceType || '',
    verificationStatus: record.verification_status || raw.verificationStatus || '',
    verificationReason: record.verification_reason || raw.verificationReason || '',
    createdAt: record.created_at || raw.createdAt || '',
    updatedAt: record.updated_at || raw.updatedAt || '',
    lastVerifiedAt: record.last_verified_at || raw.lastVerifiedAt || '',
  };
}

async function getPropertyImageCache(cacheKey) {
  if (!cacheKey) return null;
  if (supabaseConfig()) {
    const res = await supabaseRequest(`property_image_cache?id=eq.${encodeURIComponent(cacheKey)}&select=*&limit=1`);
    const rows = await res.json();
    return imageCacheFromRecord(rows[0]);
  }
  return propertyImageCacheStore().get(cacheKey, { type: 'json' });
}

async function savePropertyImageCache(cacheKey, entry) {
  if (!cacheKey) return null;
  const now = new Date().toISOString();
  const next = {
    ...entry,
    cacheKey,
    updatedAt: now,
    lastVerifiedAt: entry.lastVerifiedAt || now,
    createdAt: entry.createdAt || now,
  };
  if (supabaseConfig()) {
    await supabaseRequest('property_image_cache?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: cacheKey,
        property_id: next.propertyId || null,
        property_name: next.propertyName || null,
        property_address: next.propertyAddress || null,
        official_website: next.officialWebsite || null,
        image_url: next.imageUrl || null,
        source_page_url: next.sourcePageUrl || null,
        source_domain: next.sourceDomain || null,
        source_type: next.sourceType || null,
        verification_status: next.verificationStatus || null,
        verification_reason: next.verificationReason || null,
        raw_cache: next,
        updated_at: now,
        last_verified_at: next.lastVerifiedAt,
      }),
    });
    return next;
  }
  await propertyImageCacheStore().setJSON(cacheKey, next);
  return next;
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
        manychat_contact_id: normalizeManyChatContactId(entry.manychat_contact_id || entry.manychatContactId) || null,
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
  getLeadByEmail,
  claimAgentHandoff,
  markAgentHandoffComplete,
  markAgentHandoffFailed,
  getEntitlements,
  patchEntitlements,
  getProtectedFile,
  saveApartmentResults,
  getApartmentResults,
  getPropertyImageCache,
  savePropertyImageCache,
  saveWaitingListEntry,
};
