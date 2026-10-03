
const PREVIEW_MODE = new URLSearchParams(window.location.search).get('preview') === '1';
const CHECKOUT_URL = '/rentready-review-checkout';

function goToUnlock(){
  try { rrTrack('listing_preview_unlock_clicked', { lead_id: currentLeadId(), city: criteria.city }); } catch (_e) {}
  const token = returnAccessToken();
  window.location.href = CHECKOUT_URL + (token ? '?token=' + encodeURIComponent(token) : '');
}

async function confirmListingAccess(){
  if (PREVIEW_MODE) return true;
  if (returnAccessToken()) return true;
  const params = new URLSearchParams(window.location.search);
  const answers = readAnswers();
  const leadId = answers.lead_id || params.get("leadId") || "";

  if (leadId && window.rrnFetchEntitlements) {
    try {
      const ent = await rrnFetchEntitlements(leadId);
      if (ent && ent.listingAccessStatus === "active") return true;
    } catch (_e) {}
  }

  return !!(window.rrnHasRecentFlowAccess && rrnHasRecentFlowAccess("apartment-list", {
    statuses: ["upsell-success", "upsell-declined", "upsell-skipped", "registered-return"],
  }));
}

async function requireListingAccess(){
  const allowed = await confirmListingAccess();
  if (!allowed) {
    showListingAccessModal();
    return false;
  }
  return true;
}

function returnAccessToken(){
  try { return new URLSearchParams(window.location.search || "").get("token") || ""; }
  catch (_e) { return ""; }
}

function showListingAccessModal(message){
  let overlay = document.getElementById("listingAccessOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "listingAccessOverlay";
    overlay.innerHTML = `
      <div class="listing-access-modal" role="dialog" aria-modal="true" aria-labelledby="listingAccessTitle">
        <p class="listing-access-kicker">RentReady membership</p>
        <h2 id="listingAccessTitle">Your Listing Access Is Inactive</h2>
        <p id="listingAccessCopy">Your RentReady listing membership is no longer active. Renew your $9.99/month membership to continue viewing your apartment matches and listing details.</p>
        <div class="listing-access-actions">
          <button class="btn btn-primary" type="button" id="renewListingAccessBtn">RENEW LISTING ACCESS — $9.99/MONTH</button>
          <button class="btn btn-secondary" type="button" id="differentCardBtn">Use a Different Card</button>
        </div>
      </div>
    `;
    const style = document.createElement("style");
    style.textContent = `
      #listingAccessOverlay{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:18px;background:rgba(10,25,18,.62);backdrop-filter:blur(12px)}
      .listing-access-modal{width:min(520px,100%);border-radius:22px;background:#f8fbf7;color:#153d2b;box-shadow:0 26px 80px rgba(0,0,0,.28);padding:28px;border:1px solid rgba(26,71,49,.14);text-align:left}
      .listing-access-kicker{margin:0 0 8px;text-transform:uppercase;letter-spacing:.12em;font-size:12px;font-weight:900;color:#5f7c6d}
      .listing-access-modal h2{margin:0 0 12px;font-size:clamp(26px,4vw,38px);line-height:1.02;letter-spacing:0;color:#123d2a}
      .listing-access-modal p{margin:0;color:#587063;line-height:1.55;font-weight:650}
      .listing-access-actions{display:grid;gap:10px;margin-top:22px}
      .listing-access-actions .btn{width:100%;justify-content:center;min-height:52px}
      @media(max-width:520px){.listing-access-modal{border-radius:18px;padding:22px}.listing-access-actions .btn{font-size:13px;white-space:normal}}
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
    const renew = () => goToUnlock();
    document.getElementById("renewListingAccessBtn")?.addEventListener("click", renew);
    document.getElementById("differentCardBtn")?.addEventListener("click", renew);
  }
  const copy = document.getElementById("listingAccessCopy");
  if (copy && message) copy.textContent = message;
  overlay.style.display = "grid";
}

/* =====================================================================
   RENTREADY — RESULTS EXPERIENCE
   Production listing cards are rendered only from server-side Google Places
   results tied to the saved questionnaire lead.
   ===================================================================== */

const ALL_PREFS = ["Modern","Pool","Fitness Center","Balcony","High-Rise","Pet Friendly"];

let criteria = {
  city: "",
  area: "",
  style: "Luxury",
  budgetMax: 3000,
  budgetMin: null,
  bedrooms: 2,
  preferences: ["Modern","Pool","Fitness Center","Balcony","High-Rise","Pet Friendly"],
};

let currentResults = [];
let serverResults = null;
let serverLoadMessage = "";
let listingState = "idle";
let listingErrorMessage = "";
let nearbyAreas = [];
let hasSavedLead = false;
let loadingSequenceTimer = null;
let loadingStatusTimer = null;
const bedroomLabel = n => n === 0 ? "Studio" : (n >= 4 ? "4+ Bedrooms" : n + (n===1?" Bedroom":" Bedrooms"));
const money = n => "$" + n.toLocaleString("en-US");
const htmlEscape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
// Listing data comes from Google Places / OpenAI, so everything inserted
// into HTML is escaped and every link is restricted to http(s)/tel.
const safeHttpUrl = value => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  // Same-origin relative paths (e.g. our own image proxy) are kept as-is.
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw, window.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch (_e) {
    return "";
  }
};
const telHref = value => String(value ?? "").replace(/[^0-9+]/g, "");
const jsString = value => JSON.stringify(String(value ?? "")).replace(/[<>&]/g, ch => ({ "<":"\\u003c", ">":"\\u003e", "&":"\\u0026" }[ch]));

function readAnswers(){
  try {
    return JSON.parse(sessionStorage.getItem("rrn_answers_v1") || localStorage.getItem("rrn_answers_v1") || "{}") || {};
  } catch (_e) {
    return {};
  }
}

const SEARCH_OVERRIDE_KEY = "rrn_listing_search_v1";
const PRICE_RANGES = [
  { min: 0, max: 1000, label: "Under $1,000" },
  { min: 1000, max: 1500, label: "$1,000 – $1,500" },
  { min: 1500, max: 2000, label: "$1,500 – $2,000" },
  { min: 2000, max: 2500, label: "$2,000 – $2,500" },
  { min: 2500, max: 3000, label: "$2,500 – $3,000" },
  { min: 3000, max: 4000, label: "$3,000 – $4,000" },
  { min: 4000, max: 6000, label: "$4,000+" },
];
const US_STATES = ["AL","AK","AZ","AR","CA","CO","CT","DC","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

function currentLeadId(){
  const answers = readAnswers();
  return new URLSearchParams(window.location.search).get("leadId") || answers.lead_id || answers.leadId || "";
}

// City/price chosen in the search dropdown, kept per lead so reloads keep the same search.
function readSearchOverride(){
  try {
    const saved = JSON.parse(localStorage.getItem(SEARCH_OVERRIDE_KEY) || "null");
    return saved && saved.city && saved.leadId === currentLeadId() ? saved : null;
  } catch (_e) {
    return null;
  }
}

function saveSearchOverride(override){
  try { localStorage.setItem(SEARCH_OVERRIDE_KEY, JSON.stringify({ ...override, leadId: currentLeadId() })); } catch (_e) {}
}

function budgetLabel(){
  const range = PRICE_RANGES.find(r => r.min === criteria.budgetMin && r.max === criteria.budgetMax);
  return range ? range.label : "Up to " + money(criteria.budgetMax);
}

function applyAnswerCriteria(){
  const answers = readAnswers();
  const params = new URLSearchParams(window.location.search);
  const rentBudget = Number(answers.rent_budget);
  const urlCity = params.get("city") || params.get("c__y") || params.get("location") || "";
  const urlArea = params.get("area") || params.get("searchArea") || "";
  const urlBudget = Number(params.get("rentBudget") || params.get("budget") || "");
  const urlBeds = params.get("bedrooms") || params.get("beds") || "";
  const city = answers.preferred_city || answers.city || urlCity || "";
  criteria = {
    ...criteria,
    city,
    area: urlArea || city,
    style: "Apartment",
    budgetMax: Number.isFinite(rentBudget) && rentBudget > 0 ? rentBudget : Number.isFinite(urlBudget) && urlBudget > 0 ? urlBudget : criteria.budgetMax,
    bedrooms: answers.beds_needed ? normalizeBedrooms(answers.beds_needed) : urlBeds ? normalizeBedrooms(urlBeds) : criteria.bedrooms,
  };
  const override = readSearchOverride();
  if (override) {
    criteria.city = override.city;
    criteria.area = override.city;
    criteria.budgetMax = override.rentBudgetMax || criteria.budgetMax;
    criteria.budgetMin = override.rentBudgetMax ? override.rentBudgetMin : null;
  }
}

function normalizeBedrooms(value){
  const raw = String(value || "").split(",")[0].trim().toLowerCase();
  if (!raw || raw === "studio") return 0;
  if (raw.includes("4")) return 4;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(4, n)) : 2;
}

function styleAdjacent(a,b){
  const groups = { Luxury:["Luxury","Modern"], Modern:["Modern","Luxury","Standard"], Standard:["Standard","Modern"] };
  return groups[a]?.includes(b);
}
function computeMatch(apt, crit){
  let score = 0;
  const matchedPrefs = [];
  if(!crit.area || crit.area === crit.city) score += 15;
  else if(apt.area === crit.area) score += 25;
  else score += 6;

  if(apt.style === crit.style) score += 25;
  else if(styleAdjacent(crit.style, apt.style)) score += 13;
  else score += 3;

  const bedsOk = apt.bedroomsOffered.includes(crit.bedrooms);
  const bedsClose = apt.bedroomsOffered.some(b => Math.abs(b - crit.bedrooms) === 1);
  if(bedsOk) score += 20; else if(bedsClose) score += 9;

  const prefMap = { "Modern": apt.modern, "Pool": apt.pool, "Fitness Center": apt.fitnessCenter, "Balcony": apt.balcony, "High-Rise": apt.highRise, "Pet Friendly": apt.petFriendly };
  const selected = crit.preferences.length ? crit.preferences : ALL_PREFS;
  let hit = 0;
  selected.forEach(p => { if(prefMap[p]){ hit++; matchedPrefs.push(p); } });
  score += selected.length ? Math.round((hit/selected.length)*20) : 10;

  let budgetNote = null;
  if(apt.estRent.min <= crit.budgetMax) score += 10;
  else if(apt.estRent.min <= crit.budgetMax * 1.12){ score += 4; budgetNote = "priced slightly above your target budget"; }
  else budgetNote = "priced above your target budget";

  score = Math.max(0, Math.min(99, Math.round(score)));

  const reasonBits = [];
  if(apt.area === crit.area) reasonBits.push(`is located in ${apt.area}`);
  else reasonBits.push(`is in ${apt.area}, close to ${crit.area}`);
  if(apt.style === crit.style) reasonBits.push(`matches the ${crit.style.toLowerCase()} style you selected`);
  if(matchedPrefs.length) reasonBits.push(`offers ${matchedPrefs.slice(0,3).join(", ").toLowerCase()}`);
  const matchReason = `This community ${reasonBits.join(", ")}.`;

  const locationSummary = apt.area === crit.area
    ? `Sits right in ${apt.area}, matching your preferred area.`
    : `Located in ${apt.area}, a short drive from ${crit.area}.`;

  const bestFor = bedsOk
    ? `Best for renters looking for a ${bedroomLabel(crit.bedrooms).toLowerCase()} ${crit.style.toLowerCase()} home in ${apt.area}.`
    : `Best for renters flexible on bedroom count who want ${apt.area}.`;

  let potentialTradeoff;
  if(budgetNote) potentialTradeoff = `This community is ${budgetNote} — confirm current pricing and any move-in specials directly with the property.`;
  else if(!bedsOk) potentialTradeoff = `Doesn't currently list a ${bedroomLabel(crit.bedrooms).toLowerCase()} layout — confirm availability directly with the property.`;
  else if(selected.length && hit < selected.length) potentialTradeoff = `Doesn't confirm every amenity you selected — confirm current amenities directly with the property.`;
  else potentialTradeoff = `Confirm current availability directly with the property.`;

  const tags = [];
  if(apt.style) tags.push(apt.style);
  if(apt.highRise) tags.push("High-Rise");
  matchedPrefs.forEach(p => { if(p !== "Modern" && p !== "High-Rise" && !tags.includes(p)) tags.push(p); });
  if(!tags.includes(apt.area)) tags.push(apt.area);

  return { propertyId: apt.id, matchScore: score, matchReason, locationSummary, bestFor, potentialTradeoff, tags: tags.slice(0,4) };
}
function rankApartments(crit){
  if (Array.isArray(serverResults) && serverResults.length) {
    return serverResults;
  }
  return [];
}

const APARTMENT_RESULTS_TIMEOUT_MS = 52000;

async function fetchWithTimeout(url, options, timeoutMs = APARTMENT_RESULTS_TIMEOUT_MS){
  const controller = new AbortController();
  const timeout = setTimeout(()=> controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadVerifiedApartmentResults(){
  const answers = readAnswers();
  const urlParams = new URLSearchParams(window.location.search);
  const leadId = urlParams.get("leadId") || answers.lead_id || answers.leadId || "";
  const accessToken = returnAccessToken();
  const upsellPaymentIntentId = urlParams.get("upsellPaymentIntentId") || "";
  const prescreenPaymentIntentId =
    urlParams.get("prescreenPaymentIntentId") ||
    (window.rrnPrescreenPaymentIntentId ? rrnPrescreenPaymentIntentId() : "");
  const apartmentPrepPaymentIntentId =
    upsellPaymentIntentId ||
    urlParams.get("apartmentPrepPaymentIntentId") ||
    (window.rrnApartmentPaymentIntentId ? rrnApartmentPaymentIntentId("apartment_prep") : "");
  hasSavedLead = !!leadId;
  listingErrorMessage = "";
  if (!leadId && !accessToken) {
    listingState = "error";
    serverResults = [];
    nearbyAreas = [];
    serverLoadMessage = "We could not find your listing session. Please return to your results and try again.";
    return;
  }
  listingState = "loading";
  serverResults = [];
  try {
    const payload = {
      leadId,
      token: accessToken,
      preview: PREVIEW_MODE,
      answers,
      requestCriteria: {
        city: criteria.city,
        area: criteria.area,
        rentBudget: criteria.budgetMax,
        bedrooms: criteria.bedrooms,
        moveTimeline: answers.move_timeline || answers.moveTimeline || "",
        moveReason: answers.move_reason || answers.moveReason || "",
      },
      fallbackCriteria: {
        city: criteria.city || answers.preferred_city || answers.city || "",
        area: criteria.area || criteria.city || answers.preferred_city || answers.city || "",
        budgetMax: criteria.budgetMax,
        bedrooms: criteria.bedrooms,
      },
    };
    const searchOverride = readSearchOverride();
    if (searchOverride) {
      payload.searchOverride = {
        city: searchOverride.city,
        rentBudgetMin: searchOverride.rentBudgetMin,
        rentBudgetMax: searchOverride.rentBudgetMax,
      };
    }
    if (apartmentPrepPaymentIntentId) payload.upsellPaymentIntentId = apartmentPrepPaymentIntentId;
    if (prescreenPaymentIntentId) payload.prescreenPaymentIntentId = prescreenPaymentIntentId;
    let res = await fetchWithTimeout("/.netlify/functions/get-apartment-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = await res.json().catch(()=>({}));
    if (res.status === 404 && errorCode(data) === "LEAD_NOT_FOUND" && await resyncSavedQuestionnaire(answers)) {
      res = await fetchWithTimeout("/.netlify/functions/get-apartment-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      data = await res.json().catch(()=>({}));
    }
    if (!res.ok || !data.ok) {
      if (res.status === 403 && errorCode(data) === "LISTING_ACCESS_DENIED") {
        showListingAccessModal(errorMessage(data) || undefined);
      }
      throw new Error(errorMessage(data) || "Could not load apartment results.");
    }
    if (data.criteria) {
      criteria.city = data.criteria.city || criteria.city;
      criteria.area = data.criteria.searchArea || data.criteria.city || criteria.area;
      criteria.style = "Apartment";
      criteria.budgetMax = Number(data.criteria.rentBudget) || criteria.budgetMax;
      criteria.budgetMin = typeof data.criteria.rentBudgetMin === "number"
        ? data.criteria.rentBudgetMin
        : searchOverride && searchOverride.rentBudgetMax === criteria.budgetMax ? searchOverride.rentBudgetMin : null;
      criteria.bedrooms = normalizeBedrooms(data.criteria.bedrooms);
    }
    nearbyAreas = Array.isArray(data.nearbyAreas) ? data.nearbyAreas : [];
    const properties = Array.isArray(data.properties) ? data.properties : [];
    serverResults = properties.map(serverPropertyToResult);
    listingState = serverResults.length ? "success" : "empty";
    serverLoadMessage = data.message || "";
    if (data.message) {
      document.getElementById("heroSub").textContent = data.message;
    }
  } catch (err) {
    console.warn("Verified apartment results unavailable", err);
    listingState = "error";
    nearbyAreas = [];
    serverResults = [];
    listingErrorMessage = err.name === "AbortError"
      ? "Apartment results are taking longer than expected. Refresh in a moment to reload your verified matches."
      : err.message || "Verified apartment results could not be loaded right now.";
    serverLoadMessage = listingErrorMessage;
  }
}

function errorCode(data){
  return data && data.error && typeof data.error === "object" ? data.error.code : "";
}

function errorMessage(data){
  if (!data) return "";
  if (data.error && typeof data.error === "object") return data.error.message || "";
  return typeof data.error === "string" ? data.error : "";
}

async function resyncSavedQuestionnaire(answers){
  try {
    const res = await fetchWithTimeout("/.netlify/functions/submit-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answers),
    }, 12000);
    const data = await res.json().catch(()=>({}));
    return !!(res.ok && data && data.saved);
  } catch (_e) {
    return false;
  }
}

function serverPropertyToResult(property){
  const phone = property.phone || "";
  const apt = {
    // IDs are embedded in inline onclick handlers, so restrict them to the
    // characters Google place IDs (and preview IDs) actually use.
    id: String(property.propertyId || "").replace(/[^A-Za-z0-9_.:-]/g, ""),
    name: property.name || "Apartment community",
    area: property.area || criteria.city,
    address: property.address || "",
    phone,
    phoneDisplay: phone,
    website: safeHttpUrl(property.website),
    mapsUrl: safeHttpUrl(property.directions),
    photoName: property.photoName || "",
    authorAttributions: Array.isArray(property.authorAttributions) ? property.authorAttributions : [],
    rating: typeof property.rating === "number" ? property.rating : null,
    reviewCount: typeof property.reviewCount === "number" ? property.reviewCount : null,
    photo: safeHttpUrl(property.image),
    locationLabel: property.address || criteria.city,
    style: criteria.style,
    highRise: null,
    bedroomsOffered: [],
    pool: null,
    fitnessCenter: null,
    balcony: null,
    petFriendly: null,
    modern: null,
    estRent: null,
    source: property.source || "Google Places",
    facts: [],
  };
  const reasons = Array.isArray(property.matchReasons) ? property.matchReasons : [];
  return {
    verified: apt,
    rentReady: {
      propertyId: apt.id,
      matchScore: Number(property.matchScore) || 80,
      matchReason: reasons.join(" ") || property.summary || "Matched from your saved RentReady search criteria.",
      locationSummary: property.address ? `Located near ${property.address}.` : `Located around ${criteria.city}.`,
      bestFor: property.summary || `Best for renters searching for apartments in ${criteria.city}.`,
      potentialTradeoff: property.availabilityNote || "Confirm current availability directly with the property.",
      tags: [criteria.city, property.website ? "Website available" : "", property.phone ? "Phone available" : ""].filter(Boolean).slice(0,4),
    },
  };
}

const ICONS = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.4 7-11.5A7 7 0 0 0 5 9.5C5 14.6 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.2 6.8.7-5.1 4.6 1.5 6.7L12 17.4 5.9 20.7l1.5-6.7-5.1-4.6 6.8-.7L12 2.5z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V3"/><path d="M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  hide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6A2 2 0 0 0 13.4 13.4"/><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c5 0 9 5 10 8a13.8 13.8 0 0 1-2.6 4.3"/><path d="M6.6 6.6A13.5 13.5 0 0 0 2 12c1 3 5 8 10 8a10.8 10.8 0 0 0 4.2-.9"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 2 .6 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.5 2.9.6a2 2 0 0 1 1.8 2.1z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 20l-6-3V4l6 3 6-3 6 3v13l-6-3-6 3z"/><path d="M9 7v13M15 4v13"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 12.6L12 21.2 2.8 12 11.4 3.4H20a1 1 0 0 1 1 1v8.2z"/><circle cx="16" cy="8" r="1.4"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.3l2.4 2.4L16 10"/></svg>',
};

function ratingHtml(apt){
  if(!apt.rating) return "";
  const count = typeof apt.reviewCount === "number" ? ` <span class="rc">(${apt.reviewCount})</span>` : "";
  return `<span class="listing-rating">${ICONS.star} ${Number(apt.rating).toFixed(1)}${count}</span>`;
}
function rentRangeHtml(apt){
  if(!apt.estRent) return "Contact for pricing";
  if(apt.estRent.min === apt.estRent.max) return `${money(apt.estRent.min)} <span>/ target budget</span>`;
  return `${money(apt.estRent.min)} - ${money(apt.estRent.max)} <span>/ mo</span>`;
}
function listingFactsHtml(apt, crit){
  const facts = Array.isArray(apt.facts) && apt.facts.length
    ? apt.facts
    : [
        apt.bedroomsOffered && apt.bedroomsOffered.includes(crit.bedrooms) ? bedroomLabel(crit.bedrooms).replace("Bedrooms", "beds").replace("Bedroom", "bed") : "",
        apt.highRise === true ? "High-rise" : apt.highRise === false ? "Garden-style" : "",
        apt.petFriendly === true ? "Pet friendly" : "",
      ].filter(Boolean);
  if (!facts.length) return "";
  return facts.map((fact, i) => `${i ? "<span>·</span>" : ""}${htmlEscape(fact)}`).join(" ");
}
function photoHtml(apt) {
  if (apt.photo && apt.id) {
    return `<img src="${htmlEscape(apt.photo)}"
      alt="${htmlEscape(apt.name || "Apartment community")}"
      loading="lazy"
      decoding="async"
      data-property-id="${htmlEscape(apt.id)}"
      onerror="listingImageFallback(this)">${photoAttributionHtml(apt)}`;
  }
  if (apt.id) {
    return listingPhotoFallbackHtml(apt);
  }

  return listingPhotoFallbackHtml();
}
function photoAttributionHtml(apt){
  const attribution = Array.isArray(apt.authorAttributions) ? apt.authorAttributions[0] : null;
  if (!attribution) return "";
  const label = htmlEscape(attribution.displayName || "Google contributor");
  const href = htmlEscape(safeHttpUrl(attribution.uri));
  return href
    ? `<a class="photo-attribution" href="${href}" target="_blank" rel="noopener" aria-label="Photo attribution">${label}</a>`
    : `<span class="photo-attribution">${label}</span>`;
}
function listingPhotoFallbackHtml(apt){
  if (apt && apt.id) {
    return `<div class="photo-placeholder"
      role="img"
      aria-label="No property photo available"
      data-property-id="${htmlEscape(apt.id)}"
      data-property-name="${htmlEscape(apt.name || "")}"
      data-property-address="${htmlEscape(apt.address || "")}"
      data-property-website="${htmlEscape(apt.website || "")}">${ICONS.pin}</div>`;
  }
  return `<div class="photo-placeholder" role="img" aria-label="No property photo available">${ICONS.pin}</div>`;
}
function listingImageFallback(img){
  if (!img || !img.parentNode) return;
  const id = img.dataset && img.dataset.propertyId;
  const result = id ? currentResults.find(r => r.verified.id === id) : null;
  const attribution = img.nextElementSibling;
  if (attribution && attribution.classList.contains("photo-attribution")) attribution.remove();
  const template = document.createElement("template");
  template.innerHTML = listingPhotoFallbackHtml(result ? result.verified : null).trim();
  const holder = template.content.firstElementChild;
  img.replaceWith(holder);
  // The Google photo failed, so try the verified official-site image resolver.
  if (result) queueListingImageResolution(holder);
}
const imageResolutionQueue = [];
const imageResolutionActive = new Set();
const imageResolutionDone = new Set();
const MAX_IMAGE_RESOLUTION_CONCURRENCY = 2;
let imageResolutionRunning = 0;

function queueListingImageResolution(node){
  if (PREVIEW_MODE) return;
  if (!node || !node.dataset || !node.dataset.propertyId) return;
  const key = `${node.dataset.propertyId}|${node.dataset.propertyName}|${node.dataset.propertyAddress}`;
  if (imageResolutionDone.has(key) || imageResolutionActive.has(key)) return;
  imageResolutionActive.add(key);
  imageResolutionQueue.push({ key, node });
  runImageResolutionQueue();
}

function resolveListingImages(root){
  const scope = root || document;
  if (!scope.querySelectorAll) return;
  scope.querySelectorAll(".photo-placeholder[data-property-id]").forEach(queueListingImageResolution);
}

function runImageResolutionQueue(){
  while (imageResolutionRunning < MAX_IMAGE_RESOLUTION_CONCURRENCY && imageResolutionQueue.length) {
    const job = imageResolutionQueue.shift();
    imageResolutionRunning += 1;
    resolveListingImage(job)
      .catch(() => {})
      .finally(() => {
        imageResolutionRunning -= 1;
        imageResolutionActive.delete(job.key);
        imageResolutionDone.add(job.key);
        runImageResolutionQueue();
      });
  }
}

async function resolveListingImage(job){
  const node = job && job.node;
  if (!node || !node.parentNode || !node.dataset) return;
  const payload = {
    propertyId: node.dataset.propertyId || "",
    name: node.dataset.propertyName || "",
    address: node.dataset.propertyAddress || "",
    website: node.dataset.propertyWebsite || "",
  };
  const res = await fetchWithTimeout("/.netlify/functions/resolve-property-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 14000);
  const data = await res.json().catch(()=>null);
  if (!res.ok || !data || data.ok !== true || !data.imageUrl) return;
  const resolvedUrl = safeHttpUrl(data.imageUrl);
  if (!resolvedUrl || !node.parentNode) return;
  const img = document.createElement("img");
  img.src = resolvedUrl;
  img.alt = `${payload.name || "Apartment community"} exterior`;
  img.loading = "lazy";
  img.onerror = function(){ listingImageFallback(this); };
  node.replaceWith(img);
}
function callLineHtml(apt){
  if (PREVIEW_MODE) return `<div class="preview-locked-line"><span class="preview-lock">🔒</span><span>Contact details unlock with your results</span></div>`;
  if(apt.phone){
    return `<div class="call-line">${ICONS.phone}<span>Call for availability:</span><a href="tel:${htmlEscape(telHref(apt.phone))}">${htmlEscape(apt.phoneDisplay)}</a></div>`;
  }
  return `<div class="no-phone">No phone listed — visit the property website to check availability</div>`;
}
function actionButtonsHtml(apt){
  if (PREVIEW_MODE) return `<div class="listing-actions"><button class="btn btn-primary preview-unlock-btn" type="button" onclick="goToUnlock()">Start Listing Access — $9.99/month</button></div>`;
  const secondary = apt.phone
    ? (apt.website ? `<a class="btn btn-secondary" href="${htmlEscape(apt.website)}" target="_blank" rel="noopener">${ICONS.globe} Check availability</a>` : apt.mapsUrl ? `<a class="btn btn-secondary" href="${htmlEscape(apt.mapsUrl)}" target="_blank" rel="noopener">${ICONS.map} Maps</a>` : "")
    : (apt.website ? `<a class="btn btn-primary" href="${htmlEscape(apt.website)}" target="_blank" rel="noopener">${ICONS.globe} Check availability</a>` : apt.mapsUrl ? `<a class="btn btn-primary" href="${htmlEscape(apt.mapsUrl)}" target="_blank" rel="noopener">${ICONS.map} View on maps</a>` : "");
  return `<div class="listing-actions">
      <button class="btn btn-primary" type="button" onclick="openPropertyModal('${apt.id}')">View apartment</button>
      ${secondary}
    </div>`;
}
function listingHtml(result, index, isTop){
  const { verified: apt, rentReady: rr } = result;
  const facts = listingFactsHtml(apt, criteria);
  return `
  <article class="listing ${isTop ? "top" : ""}">
    <div class="listing-num">${index + 1}</div>
    <div class="listing-photo">
      ${photoHtml(apt)}
      <div class="photo-actions">
        <button class="icon-btn" type="button" onclick="shareProperty('${apt.id}')" aria-label="Share ${htmlEscape(apt.name)}">${ICONS.share}</button>
        <button class="icon-btn" type="button" onclick="hideProperty('${apt.id}')" aria-label="Hide ${htmlEscape(apt.name)}">${ICONS.hide}</button>
        <button class="icon-btn" type="button" onclick="openPropertyModal('${apt.id}')" aria-label="More options for ${htmlEscape(apt.name)}">${ICONS.more}</button>
      </div>
      <span class="status-pill"><span class="status-dot"></span> Verified community</span>
    </div>
    <div class="listing-main">
      <div class="listing-top-row">
        <div class="listing-name-wrap">
          <span class="listing-name">${htmlEscape(apt.name)}</span>
          ${isTop ? `<span class="best-badge">Best match</span>` : ""}
        </div>
      </div>
      <div class="listing-loc">${ICONS.pin} ${htmlEscape(apt.locationLabel || apt.address || apt.area)} ${ratingHtml(apt)}</div>
      <div class="listing-price">${rentRangeHtml(apt)}</div>
      ${facts ? `<div class="listing-details">${facts}</div>` : ""}
      <p class="listing-reason">${htmlEscape(rr.matchReason)}</p>
      <div class="listing-tags">${rr.tags.map(t=>`<span class="tag">${htmlEscape(t)}</span>`).join("")}</div>
      <div class="listing-footer">
        ${callLineHtml(apt)}
        ${actionButtonsHtml(apt)}
      </div>
    </div>
  </article>`;
}

function renderHeroAndSummary(){
  const cityLabel = criteria.city || "";
  const cityName = cityLabel ? cityLabel.split(",")[0].trim() || cityLabel : "";
  const matchText = `${currentResults.length} ${currentResults.length === 1 ? "apartment community" : "apartment communities"}`;
  const bedroomText = bedroomLabel(criteria.bedrooms).toLowerCase();
  document.getElementById("heroTitle").textContent = PREVIEW_MODE ? "We Found Apartments That Match Your Search" : "Your Apartment Options";
  document.getElementById("scLocation").textContent = criteria.city || "City needed";
  document.getElementById("scStyle").textContent = criteria.style;
  document.getElementById("scBudget").textContent = budgetLabel();
  document.getElementById("scBedrooms").textContent = bedroomLabel(criteria.bedrooms);
  document.getElementById("heroSub").textContent = PREVIEW_MODE
    ? `Preview ${matchText} based on your search. Start $9.99/month listing access to see property names, full locations, contact details, and your RentReady results.`
    : heroSubText(matchText, bedroomText, cityName);
  document.getElementById("nearbyCopy").textContent = nearbyAreas.length
    ? `Explore apartment communities near ${criteria.city}.`
    : `Nearby options will appear here when verified results are available.`;
}

function heroSubText(matchText, bedroomText, cityName){
  if (listingState === "loading") return criteria.city
    ? `Searching Google for apartment communities in ${cityName || criteria.city}.`
    : "Loading your saved RentReady listing criteria.";
  if ((listingState === "empty" || listingState === "error") && serverLoadMessage) return serverLoadMessage;
  return criteria.city
    ? "We used the area and apartment preferences you shared to find communities worth exploring. Confirm current pricing, availability, and screening details directly with each property."
    : "Enter a city and state to search verified apartment communities.";
}

function levelWord(v){ return v >= 80 ? "Excellent" : v >= 60 ? "Strong" : v >= 40 ? "Good" : "Limited"; }
function levelClass(v){ return v >= 60 ? "good" : "mid"; }

function renderMatchStrip(){
  const strip = document.getElementById("matchStrip");
  if(!currentResults.length){ strip.innerHTML = ""; return; }
  const n = currentResults.length;
  const avg = key => currentResults.reduce((s,r)=>s + key(r), 0) / n;
  const areaScore = avg(r => r.verified.area === criteria.area ? 100 : 55);
  const styleScore = avg(r => r.verified.style === criteria.style ? 100 : (styleAdjacent(criteria.style, r.verified.style) ? 65 : 30));
  const selected = criteria.preferences.length ? criteria.preferences : ALL_PREFS;
  const prefMap = a => ({ "Modern": a.modern, "Pool": a.pool, "Fitness Center": a.fitnessCenter, "Balcony": a.balcony, "High-Rise": a.highRise, "Pet Friendly": a.petFriendly });
  const amenityScore = avg(r => { const m = prefMap(r.verified); const hit = selected.filter(p=>m[p]).length; return (hit/selected.length)*100; });

  const cards = [
    { label:"Location match", value: levelWord(areaScore), cls: levelClass(areaScore) },
    { label:"Style match", value: levelWord(styleScore), cls: levelClass(styleScore) },
    { label:"Amenities match", value: levelWord(amenityScore), cls: levelClass(amenityScore) },
    { label:"Budget match", value:"Verify current pricing", cls:"neutral" },
  ];
  strip.innerHTML = cards.map(c => `
    <div class="match-pill ${c.cls}"><span class="dot"></span><span><span class="mp-label">${c.label}</span><span class="mp-value">${c.value}</span></span></div>
  `).join("");
}

function renderResults(){
  const listSection = document.getElementById("listSection");
  const emptySection = document.getElementById("emptySection");
  if(!currentResults.length){
    listSection.style.display = "none";
    emptySection.style.display = "block";
    renderEmptyState();
    return;
  }
  listSection.style.display = "block";
  emptySection.style.display = "none";
  document.getElementById("resultCount").textContent = currentResults.length + (currentResults.length === 1 ? " match" : " matches");
  document.getElementById("listingList").innerHTML = currentResults
    .map((r,i) => listingHtml(r, i, i < 3))
    .join("");
  resolveListingImages(document.getElementById("listingList"));
}

function renderEmptyState(){
  const title = document.querySelector("#emptySection h3");
  const copy = document.querySelector("#emptySection p");
  if (!title || !copy) return;
  if (listingState === "loading" || listingState === "idle") {
    title.textContent = "We're preparing your apartment list.";
    copy.textContent = "If results are still loading, refresh your apartment list in a moment.";
    return;
  }
  if (listingState === "empty") {
    title.textContent = "No Google apartment communities found yet.";
    copy.textContent = serverLoadMessage || "Try refreshing, or broaden the city in your questionnaire and search again.";
    return;
  }
  title.textContent = "Apartment listings could not load.";
  copy.textContent = listingErrorMessage || serverLoadMessage || "Refresh your apartment list in a moment.";
}

function renderAreaPills(){
  const areas = nearbyAreas.length ? nearbyAreas : [];
  document.getElementById("areaPills").innerHTML = areas.map(a => `
    <button class="area-pill ${a===criteria.area ? "active": ""}" type="button" ${a===criteria.area ? 'disabled aria-pressed="true"' : 'aria-pressed="false"'} onclick="selectArea(${jsString(a)})">${htmlEscape(a)}</button>
  `).join("");
}
function renderAll(){
  currentResults = rankApartments(criteria);
  renderHeroAndSummary();
  renderMatchStrip();
  renderResults();
  renderAreaPills();
}
async function refreshResults(){
  await loadVerifiedApartmentResults();
  renderAll();
}

function runLoadingSequence(onDone, overlayMode){
  const overlay = document.getElementById("loadingOverlay");
  const statusEl = document.getElementById("loadStatus");
  const bar = document.getElementById("loadBar");
  if (loadingSequenceTimer) clearInterval(loadingSequenceTimer);
  if (loadingStatusTimer) clearTimeout(loadingStatusTimer);
  loadingSequenceTimer = null;
  loadingStatusTimer = null;
  overlay.classList.remove("hide");
  overlay.classList.toggle("overlay-mode", !!overlayMode);
  const messages = ["Searching apartment communities…","Checking locations…","Comparing your preferences…","Ranking your strongest matches…","Preparing your apartment list…"];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const step = reduced ? 0 : (overlayMode ? 250 : 440);
  let i = 0;
  bar.style.width = "6%";
  statusEl.style.opacity = 1;
  statusEl.textContent = messages[0];
  loadingSequenceTimer = setInterval(()=>{
    i++;
    bar.style.width = Math.min(96, (i+1) * (100/messages.length)) + "%";
    if(i < messages.length){
      statusEl.style.opacity = 0;
      if (loadingStatusTimer) clearTimeout(loadingStatusTimer);
      loadingStatusTimer = setTimeout(()=>{
        statusEl.textContent = messages[i];
        statusEl.style.opacity = 1;
        loadingStatusTimer = null;
      }, reduced ? 0 : 130);
    } else {
      clearInterval(loadingSequenceTimer);
      loadingSequenceTimer = null;
      bar.style.width = "100%";
      setTimeout(()=>{
        Promise.resolve()
          .then(onDone)
          .catch(err => {
            console.error("Could not render apartment results", err);
            serverLoadMessage = err && err.message ? err.message : "Apartment results could not be shown right now.";
            currentResults = [];
            try {
              renderHeroAndSummary();
              renderResults();
              renderAreaPills();
            } catch (_e) {}
          })
          .finally(()=> overlay.classList.add("hide"));
      }, reduced ? 0 : 220);
    }
  }, step || 10);
}

function selectArea(area){
  if (area === criteria.area) return;
  criteria.area = area;
  document.getElementById("listSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  runLoadingSequence(refreshResults, true);
}
/* ---------- search dropdown (city, state, price range) ---------- */
const summaryCard = document.getElementById("summaryCard");
const searchEditBtn = document.getElementById("searchEditBtn");
const searchPopover = document.getElementById("searchPopover");
const searchForm = document.getElementById("searchForm");
const searchCity = document.getElementById("searchCity");
const searchState = document.getElementById("searchState");
const searchPrice = document.getElementById("searchPrice");
const searchError = document.getElementById("searchError");

function setupSearchDropdown(){
  if (!searchPopover || !searchForm) return;
  searchState.innerHTML = '<option value="">State</option>' + US_STATES.map(st => `<option value="${st}">${st}</option>`).join("");
  searchPrice.innerHTML = PRICE_RANGES.map((r, i) => `<option value="${i}">${htmlEscape(r.label)}</option>`).join("");
  searchEditBtn.addEventListener("click", () => searchPopover.classList.contains("open") ? closeSearchDropdown(true) : openSearchDropdown());
  document.getElementById("searchCancelBtn").addEventListener("click", () => closeSearchDropdown(true));
  searchForm.addEventListener("submit", submitSearchDropdown);
  [searchCity, searchState].forEach(el => el.addEventListener("input", () => { el.removeAttribute("aria-invalid"); searchError.textContent = ""; }));
  document.addEventListener("click", e => {
    if (searchPopover.classList.contains("open") && !summaryCard.contains(e.target)) closeSearchDropdown(false);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && searchPopover.classList.contains("open")) closeSearchDropdown(true);
  });
}

function openSearchDropdown(){
  const match = String(criteria.city || "").match(/^(.*?),\s*([A-Za-z]{2})$/);
  searchCity.value = match ? match[1].trim() : (criteria.city || "");
  searchState.value = match && US_STATES.includes(match[2].toUpperCase()) ? match[2].toUpperCase() : "";
  const exact = PRICE_RANGES.findIndex(r => r.min === criteria.budgetMin && r.max === criteria.budgetMax);
  const covering = PRICE_RANGES.findIndex(r => criteria.budgetMax <= r.max);
  searchPrice.value = String(exact >= 0 ? exact : covering >= 0 ? covering : PRICE_RANGES.length - 1);
  searchError.textContent = "";
  [searchCity, searchState].forEach(el => el.removeAttribute("aria-invalid"));
  searchPopover.classList.add("open");
  searchPopover.setAttribute("aria-hidden", "false");
  searchEditBtn.setAttribute("aria-expanded", "true");
  setTimeout(() => (searchCity.value ? searchState : searchCity).focus(), 60);
}

function closeSearchDropdown(returnFocus){
  searchPopover.classList.remove("open");
  searchPopover.setAttribute("aria-hidden", "true");
  searchEditBtn.setAttribute("aria-expanded", "false");
  if (returnFocus) searchEditBtn.focus();
}

function submitSearchDropdown(e){
  e.preventDefault();
  const city = searchCity.value.replace(/,.*$/, "").replace(/\s+/g, " ").trim();
  const state = searchState.value;
  if (!city || !/^[A-Za-z .'-]{2,}$/.test(city)) {
    searchCity.setAttribute("aria-invalid", "true");
    searchError.textContent = "Enter a valid city name.";
    searchCity.focus();
    return;
  }
  if (!state) {
    searchState.setAttribute("aria-invalid", "true");
    searchError.textContent = "Choose a state.";
    searchState.focus();
    return;
  }
  const range = PRICE_RANGES[Number(searchPrice.value)] || PRICE_RANGES[PRICE_RANGES.length - 1];
  const cityState = `${city.replace(/\b\w/g, ch => ch.toUpperCase())}, ${state}`;
  closeSearchDropdown(false);
  const unchanged = cityState === criteria.city && range.max === criteria.budgetMax && range.min === criteria.budgetMin;
  if (unchanged) return;
  saveSearchOverride({ city: cityState, rentBudgetMin: range.min, rentBudgetMax: range.max });
  criteria.city = cityState;
  criteria.area = cityState;
  criteria.budgetMin = range.min;
  criteria.budgetMax = range.max;
  runLoadingSequence(refreshResults, true);
}

setupSearchDropdown();

document.getElementById("emptyRefreshBtn").addEventListener("click", ()=>{ runLoadingSequence(refreshResults, true); });

function hideProperty(id){
  currentResults = currentResults.filter(r => r.verified.id !== id);
  renderMatchStrip();
  renderResults();
}

async function shareProperty(id){
  const result = currentResults.find(r => r.verified.id === id);
  if (!result) return;
  const apt = result.verified;
  const url = PREVIEW_MODE ? window.location.origin + "/" : (apt.website || apt.mapsUrl || window.location.href);
  const text = `${apt.name} - ${apt.address || apt.area || criteria.city}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: apt.name, text, url });
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(url);
    }
  } catch (_e) {}
}

const modalOverlay = document.getElementById("modalOverlay");
const legalModalOverlay = document.getElementById("legalModalOverlay");
const legalModalTitle = document.getElementById("legalModalTitle");
const legalModalCopy = document.getElementById("legalModalCopy");
const legalModalClose = document.getElementById("legalModalClose");
const LEGAL_COPY = {
  privacy: {
    title: "Privacy Policy",
    body: `
      <p>RentReady uses the information you provide to prepare your apartment results, understand your housing preferences, and help connect you with relevant apartment information.</p>
      <p>Where permitted, RentReady may send housing-related updates, reminders, and marketing communications. You can opt out of marketing communications when an unsubscribe option is provided.</p>
      <p>We do not sell your personal information. We may share limited information with service providers that help us operate RentReady, process requests, improve the experience, or comply with legal requirements.</p>
    `
  },
  terms: {
    title: "Terms",
    body: `
      <p>RentReady provides apartment search and preparation information. Listing availability, pricing, fees, deposits, amenities, and screening requirements can change and should be confirmed directly with the property before applying or paying any fees.</p>
      <p>RentReady does not make rental approval decisions and does not guarantee that a renter will qualify for, tour, lease, or be approved by any apartment community.</p>
      <p>By continuing, you agree that RentReady may use your information to provide your results and, where permitted, send relevant housing and marketing communications.</p>
    `
  }
};
function openLegalModal(type){
  const content = LEGAL_COPY[type];
  if(!content || !legalModalOverlay || !legalModalTitle || !legalModalCopy) return;
  legalModalTitle.textContent = content.title;
  legalModalCopy.innerHTML = content.body;
  legalModalOverlay.classList.add("open");
  legalModalOverlay.setAttribute("aria-hidden", "false");
}
function closeLegalModal(){
  if(!legalModalOverlay) return;
  legalModalOverlay.classList.remove("open");
  legalModalOverlay.setAttribute("aria-hidden", "true");
}
document.querySelectorAll("[data-legal-modal]").forEach(btn=>{
  btn.addEventListener("click", ()=>openLegalModal(btn.dataset.legalModal));
});
legalModalClose?.addEventListener("click", closeLegalModal);
legalModalOverlay?.addEventListener("click", e=>{ if(e.target === legalModalOverlay) closeLegalModal(); });
document.addEventListener("keydown", e=>{ if(e.key === "Escape") closeLegalModal(); });

function openPropertyModal(id){
  const result = currentResults.find(r => r.verified.id === id);
  if(!result) return;
  const { verified: apt, rentReady: rr } = result;
  const webBtn = apt.website
    ? `<a class="btn btn-secondary" href="${htmlEscape(apt.website)}" target="_blank" rel="noopener">${ICONS.globe} Check availability</a>`
    : `<span class="btn btn-secondary" style="opacity:.5; pointer-events:none;">${ICONS.globe} No website listed</span>`;
  const mapsBtn = apt.mapsUrl
    ? `<a class="btn btn-secondary" href="${htmlEscape(apt.mapsUrl)}" target="_blank" rel="noopener">${ICONS.map} View on maps</a>`
    : "";
  const callBlock = PREVIEW_MODE
    ? callLineHtml(apt)
    : apt.phone
    ? `<div class="modal-call">${ICONS.phone} <span>Call for availability: <a class="num" href="tel:${htmlEscape(telHref(apt.phone))}">${htmlEscape(apt.phoneDisplay)}</a></span></div>`
    : `<div class="modal-call">${ICONS.warn} <span style="color:var(--ink-muted); font-weight:600;">No phone listed — use the property website to check availability</span></div>`;
  const actions = PREVIEW_MODE
    ? `<button class="btn btn-primary preview-unlock-btn" type="button" onclick="goToUnlock()">Start Listing Access — $9.99/month</button>`
    : `${webBtn}${mapsBtn}`;
  const address = apt.address || apt.locationLabel || apt.area || "";

  document.getElementById("modalContent").innerHTML = `
    <div class="modal-photo">
      ${photoHtml(apt)}
      <button class="close-x" type="button" onclick="closePropertyModal()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2.3" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="modal-name">${htmlEscape(apt.name)}</div>
      <div class="modal-meta">${address ? `<span class="listing-loc" style="margin:0;">${ICONS.pin} ${htmlEscape(address)}</span>` : ""}${ratingHtml(apt)}</div>

      <div class="modal-section"><h4>Why we matched it</h4><p>${htmlEscape(rr.matchReason)}</p></div>
      <div class="modal-section"><h4>Location</h4><p>${htmlEscape(rr.locationSummary)}</p></div>
      <div class="modal-section"><h4>Best for</h4><p>${htmlEscape(rr.bestFor)}</p></div>
      <div class="modal-section"><h4>Amenities</h4><div class="listing-tags">${rr.tags.map(t=>`<span class="tag">${htmlEscape(t)}</span>`).join("")}</div></div>

      ${callBlock}
      <div class="modal-actions">
        ${actions}
      </div>
      <p class="modal-disclosure">Pricing, availability and screening requirements can change — confirm current details directly with the property before applying or paying any fees.</p>
    </div>
  `;
  modalOverlay.classList.add("open");
  resolveListingImages(document.getElementById("modalContent"));
}
function closePropertyModal(){ modalOverlay.classList.remove("open"); }
modalOverlay.addEventListener("click", e => { if(e.target === modalOverlay) closePropertyModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && modalOverlay.classList.contains("open")) closePropertyModal(); });

function setupQuestionnaireBackTarget(){
  if (!window.history || window.__rrnListingBackTargetReady) return;
  window.__rrnListingBackTargetReady = true;
  try {
    window.history.replaceState({ ...(window.history.state || {}), rrnListingPage: true }, "", window.location.href);
    window.history.pushState({ rrnListingBackGuard: true }, "", window.location.href);
    window.addEventListener("popstate", (event) => {
      if (event.state && event.state.rrnListingPage) {
        window.location.replace("/");
      }
    });
  } catch (_e) {}
}

window.addEventListener("load", async ()=>{
  if (!(await requireListingAccess())) return;
  document.body.classList.toggle("preview-mode", PREVIEW_MODE);
  if (PREVIEW_MODE) {
    const edit = document.getElementById("searchEditBtn");
    if (edit) edit.style.display = "none";
    const sectionTitle = document.querySelector("#listSection .section-head h2");
    if (sectionTitle) sectionTitle.textContent = "Your apartment match preview";
  }
  setupQuestionnaireBackTarget();
  applyAnswerCriteria();
  await loadVerifiedApartmentResults();
  runLoadingSequence(renderAll, false);
});
