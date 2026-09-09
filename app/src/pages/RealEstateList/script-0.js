
async function confirmListingAccess(){
  const params = new URLSearchParams(window.location.search);
  const category = (params.get("category") || "luxury").toLowerCase();
  const answers = readAnswers();
  const leadId = answers.lead_id || params.get("leadId") || "";

  if (leadId && window.rrnFetchEntitlements) {
    try {
      const ent = await rrnFetchEntitlements(leadId);
      if (ent && ent.paid27 && ent.purchasedCategory === category) return true;
    } catch (_e) {}
  }

  return !!(window.rrnHasRecentFlowAccess && rrnHasRecentFlowAccess("apartment-list", {
    statuses: ["upsell-success"],
    category,
  }));
}

async function requireListingAccess(){
  const allowed = await confirmListingAccess();
  if (!allowed) {
    document.body.style.opacity = "0";
    window.location.replace("/after-payment-results/");
    return false;
  }
  return true;
}

/* =====================================================================
   RENTREADY — RESULTS EXPERIENCE (front-end prototype)
   MOCK_APARTMENTS stands in for verified Google Places data (production
   would fetch this server-side via googlePlacesProvider, keyed by the
   searched area/style, and never fabricate a missing field). Each
   listing's photo, address and phone belong to that specific property
   record — changing the search changes which real records are shown,
   never the images attached to them.
   rankApartments() stands in for the AI ranking step (aiRankingService)
   — it only reads facts already on each property object.
   ===================================================================== */

const MOCK_APARTMENTS = [
  { id:"p1", name:"The Ellery at South Tryon", area:"Uptown Charlotte", address:"301 S Tryon St, Charlotte, NC", phone:"+17045550142", phoneDisplay:"(704) 555-0142", website:"https://example.com/the-ellery", mapsUrl:"https://maps.google.com/?q=The+Ellery+at+South+Tryon+Charlotte+NC", rating:4.6, reviewCount:212, photo:"https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=900&q=80", style:"Luxury", highRise:true, bedroomsOffered:[1,2,3], pool:true, fitnessCenter:true, balcony:true, petFriendly:true, modern:true, estRent:{min:2400,max:3400} },
  { id:"p2", name:"Skyline House Uptown", area:"Uptown Charlotte", address:"215 N College St, Charlotte, NC", phone:"+17045550188", phoneDisplay:"(704) 555-0188", website:"https://example.com/skyline-house", mapsUrl:"https://maps.google.com/?q=Skyline+House+Uptown+Charlotte+NC", rating:4.4, reviewCount:96, photo:"https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=900&q=80", style:"Luxury", highRise:true, bedroomsOffered:[0,1,2], pool:true, fitnessCenter:true, balcony:true, petFriendly:false, modern:true, estRent:{min:2100,max:3100} },
  { id:"p3", name:"Vantage Point Apartments", area:"South End", address:"1420 South Blvd, Charlotte, NC", phone:"+17045550119", phoneDisplay:"(704) 555-0119", website:"https://example.com/vantage-point", mapsUrl:"https://maps.google.com/?q=Vantage+Point+Apartments+South+End+Charlotte+NC", rating:4.5, reviewCount:301, photo:"https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=900&q=80", style:"Modern", highRise:false, bedroomsOffered:[1,2,3], pool:true, fitnessCenter:true, balcony:true, petFriendly:true, modern:true, estRent:{min:1900,max:2700} },
  { id:"p4", name:"The Rowland NoDa", area:"NoDa", address:"3220 N Davidson St, Charlotte, NC", phone:null, phoneDisplay:null, website:"https://example.com/the-rowland", mapsUrl:"https://maps.google.com/?q=The+Rowland+NoDa+Charlotte+NC", rating:4.7, reviewCount:88, photo:"https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=900&q=80", style:"Modern", highRise:false, bedroomsOffered:[1,2], pool:false, fitnessCenter:true, balcony:true, petFriendly:true, modern:true, estRent:{min:1700,max:2300} },
  { id:"p5", name:"Ballantyne Reserve", area:"Ballantyne", address:"14700 Ballantyne Village Way, Charlotte, NC", phone:"+17045550231", phoneDisplay:"(704) 555-0231", website:"https://example.com/ballantyne-reserve", mapsUrl:"https://maps.google.com/?q=Ballantyne+Reserve+Charlotte+NC", rating:4.3, reviewCount:154, photo:"https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=900&q=80", style:"Luxury", highRise:false, bedroomsOffered:[1,2,3], pool:true, fitnessCenter:true, balcony:true, petFriendly:true, modern:false, estRent:{min:1900,max:2900} },
  { id:"p6", name:"University Pointe Flats", area:"University City", address:"9601 Ridgeleaf Rd, Charlotte, NC", phone:"+17045550267", phoneDisplay:"(704) 555-0267", website:null, mapsUrl:"https://maps.google.com/?q=University+Pointe+Flats+Charlotte+NC", rating:4.1, reviewCount:67, photo:"https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=900&q=80", style:"Standard", highRise:false, bedroomsOffered:[1,2,3], pool:true, fitnessCenter:false, balcony:false, petFriendly:true, modern:false, estRent:{min:1250,max:1750} },
  { id:"p7", name:"Dilworth Row Residences", area:"Dilworth", address:"1500 East Blvd, Charlotte, NC", phone:"+17045550298", phoneDisplay:"(704) 555-0298", website:"https://example.com/dilworth-row", mapsUrl:"https://maps.google.com/?q=Dilworth+Row+Residences+Charlotte+NC", rating:4.6, reviewCount:120, photo:"https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=900&q=80", style:"Modern", highRise:false, bedroomsOffered:[1,2], pool:false, fitnessCenter:true, balcony:true, petFriendly:true, modern:true, estRent:{min:1800,max:2500} },
  { id:"p8", name:"The Merrick at Uptown", area:"Uptown Charlotte", address:"433 W Trade St, Charlotte, NC", phone:"+17045550310", phoneDisplay:"(704) 555-0310", website:"https://example.com/the-merrick", mapsUrl:"https://maps.google.com/?q=The+Merrick+at+Uptown+Charlotte+NC", rating:4.8, reviewCount:174, photo:"https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=900&q=80", style:"Luxury", highRise:true, bedroomsOffered:[1,2,3], pool:true, fitnessCenter:true, balcony:true, petFriendly:true, modern:true, estRent:{min:2600,max:3800} },
  { id:"p9", name:"Plaza Midwood Commons", area:"Plaza Midwood", address:"1815 Central Ave, Charlotte, NC", phone:"+17045550345", phoneDisplay:"(704) 555-0345", website:"https://example.com/plaza-midwood-commons", mapsUrl:"https://maps.google.com/?q=Plaza+Midwood+Commons+Charlotte+NC", rating:4.4, reviewCount:143, photo:"https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=900&q=80", style:"Modern", highRise:false, bedroomsOffered:[0,1,2], pool:false, fitnessCenter:true, balcony:true, petFriendly:true, modern:true, estRent:{min:1600,max:2200} },
  { id:"p10", name:"South End Lofts on Camden", area:"South End", address:"1900 Camden Rd, Charlotte, NC", phone:"+17045550377", phoneDisplay:"(704) 555-0377", website:"https://example.com/south-end-lofts", mapsUrl:"https://maps.google.com/?q=South+End+Lofts+on+Camden+Charlotte+NC", rating:4.5, reviewCount:209, photo:"https://images.unsplash.com/photo-1560184897-ae75f418493e?auto=format&fit=crop&w=900&q=80", style:"Luxury", highRise:true, bedroomsOffered:[1,2,3], pool:true, fitnessCenter:true, balcony:true, petFriendly:true, modern:true, estRent:{min:2300,max:3200} },
  { id:"p11", name:"NoDa Arts District Flats", area:"NoDa", address:"2800 N Tryon St, Charlotte, NC", phone:null, phoneDisplay:null, website:"https://example.com/noda-arts-flats", mapsUrl:"https://maps.google.com/?q=NoDa+Arts+District+Flats+Charlotte+NC", rating:4.2, reviewCount:54, photo:"https://images.unsplash.com/photo-1449844908441-8829872d2607?auto=format&fit=crop&w=900&q=80", style:"Standard", highRise:false, bedroomsOffered:[0,1,2], pool:false, fitnessCenter:false, balcony:true, petFriendly:true, modern:false, estRent:{min:1150,max:1600} },
  { id:"p12", name:"University City Terrace", area:"University City", address:"8701 J.W. Clay Blvd, Charlotte, NC", phone:"+17045550402", phoneDisplay:"(704) 555-0402", website:"https://example.com/university-city-terrace", mapsUrl:"https://maps.google.com/?q=University+City+Terrace+Charlotte+NC", rating:4.0, reviewCount:81, photo:"https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=900&q=80", style:"Standard", highRise:false, bedroomsOffered:[1,2,3], pool:true, fitnessCenter:true, balcony:false, petFriendly:false, modern:false, estRent:{min:1300,max:1900} },
  { id:"p13", name:"Ballantyne Grove", area:"Ballantyne", address:"15100 John J Delaney Dr, Charlotte, NC", phone:"+17045550419", phoneDisplay:"(704) 555-0419", website:"https://example.com/ballantyne-grove", mapsUrl:"https://maps.google.com/?q=Ballantyne+Grove+Charlotte+NC", rating:4.5, reviewCount:98, photo:"https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?auto=format&fit=crop&w=900&q=80", style:"Luxury", highRise:false, bedroomsOffered:[2,3], pool:true, fitnessCenter:true, balcony:true, petFriendly:true, modern:true, estRent:{min:2200,max:3300} },
  { id:"p14", name:"Trade Street Modern", area:"Uptown Charlotte", address:"525 E Trade St, Charlotte, NC", phone:"+17045550455", phoneDisplay:"(704) 555-0455", website:"https://example.com/trade-street-modern", mapsUrl:"https://maps.google.com/?q=Trade+Street+Modern+Charlotte+NC", rating:4.3, reviewCount:62, photo:"https://images.unsplash.com/photo-1523217582562-09d0def993a6?auto=format&fit=crop&w=900&q=80", style:"Modern", highRise:true, bedroomsOffered:[1,2], pool:false, fitnessCenter:true, balcony:true, petFriendly:true, modern:true, estRent:{min:1950,max:2650} },
];

const ALL_PREFS = ["Modern","Pool","Fitness Center","Balcony","High-Rise","Pet Friendly"];

let criteria = {
  city: "",
  area: "",
  style: "Luxury",
  budgetMax: 3000,
  bedrooms: 2,
  preferences: ["Modern","Pool","Fitness Center","Balcony","High-Rise","Pet Friendly"],
};

let currentResults = [];
let serverResults = null;
let serverLoadMessage = "";
let nearbyAreas = [];
let hasSavedLead = false;
const bedroomLabel = n => n === 0 ? "Studio" : (n >= 4 ? "4+ Bedrooms" : n + (n===1?" Bedroom":" Bedrooms"));
const money = n => "$" + n.toLocaleString("en-US");
const htmlEscape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
const jsString = value => JSON.stringify(String(value ?? "")).replace(/[<>&]/g, ch => ({ "<":"\\u003c", ">":"\\u003e", "&":"\\u0026" }[ch]));

function readAnswers(){
  try {
    return JSON.parse(sessionStorage.getItem("rrn_answers_v1") || localStorage.getItem("rrn_answers_v1") || "{}") || {};
  } catch (_e) {
    return {};
  }
}

function applyAnswerCriteria(){
  const answers = readAnswers();
  const params = new URLSearchParams(window.location.search);
  const category = (params.get("category") || "luxury").toLowerCase();
  const rentBudget = Number(answers.rent_budget);
  const beds = normalizeBedrooms(answers.beds_needed);
  const urlCity = params.get("city") || params.get("c__y") || params.get("location") || "";
  const urlArea = params.get("area") || params.get("searchArea") || "";
  const urlBudget = Number(params.get("rentBudget") || params.get("budget") || "");
  const urlBeds = params.get("bedrooms") || params.get("beds") || "";
  const city = answers.preferred_city || answers.city || urlCity || "";
  criteria = {
    ...criteria,
    city,
    area: urlArea || city,
    style: category === "modern" ? "Modern" : "Luxury",
    budgetMax: Number.isFinite(rentBudget) && rentBudget > 0 ? rentBudget : Number.isFinite(urlBudget) && urlBudget > 0 ? urlBudget : criteria.budgetMax,
    bedrooms: answers.beds_needed ? beds : urlBeds ? normalizeBedrooms(urlBeds) : beds,
  };
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
  if (Array.isArray(serverResults)) {
    return serverResults;
  }
  if (hasSavedLead) return [];
  return MOCK_APARTMENTS
    .map(apt => ({ verified: apt, rentReady: computeMatch(apt, crit) }))
    .sort((a,b) => b.rentReady.matchScore - a.rentReady.matchScore)
    .filter(r => r.rentReady.matchScore >= 45);
}

function currentCategory(){
  const params = new URLSearchParams(window.location.search);
  return (params.get("category") || "luxury").toLowerCase() === "modern" ? "modern" : "luxury";
}

async function loadVerifiedApartmentResults(){
  const answers = readAnswers();
  const urlParams = new URLSearchParams(window.location.search);
  const leadId = answers.lead_id || urlParams.get("leadId") || "";
  hasSavedLead = !!leadId;
  if (!leadId) {
    serverResults = null;
    nearbyAreas = [];
    serverLoadMessage = "Previewing sample apartment cards. Complete the questionnaire to search live Google Places results.";
    return;
  }
  try {
    const category = currentCategory();
    const params = new URLSearchParams({ leadId, category });
    if (window.rrnApartmentPaymentIntentId) {
      const upsellIntentId = rrnApartmentPaymentIntentId(category);
      if (upsellIntentId) params.set("upsellPaymentIntentId", upsellIntentId);
    }
    let res = await fetch("/.netlify/functions/get-apartment-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...Object.fromEntries(params.entries()), answers, requestCriteria: criteria }),
    });
    let data = await res.json().catch(()=>({}));
    if (res.status === 404 && data.error === "No saved questionnaire was found." && await resyncSavedQuestionnaire(answers)) {
      res = await fetch("/.netlify/functions/get-apartment-results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(params.entries()), answers, requestCriteria: criteria }),
      });
      data = await res.json().catch(()=>({}));
    }
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not load apartment results.");
    if (data.criteria) {
      criteria.city = data.criteria.city || criteria.city;
      criteria.area = data.criteria.searchArea || data.criteria.city || criteria.area;
      criteria.style = data.criteria.category === "modern" ? "Modern" : "Luxury";
      criteria.budgetMax = Number(data.criteria.rentBudget) || criteria.budgetMax;
      criteria.bedrooms = normalizeBedrooms(data.criteria.bedrooms);
    }
    nearbyAreas = Array.isArray(data.nearbyAreas) ? data.nearbyAreas : [];
    serverResults = Array.isArray(data.properties) ? data.properties.map(serverPropertyToResult) : [];
    serverLoadMessage = data.message || "";
    if (data.message) {
      document.getElementById("heroSub").textContent = data.message;
    }
  } catch (err) {
    console.warn("Verified apartment results unavailable", err);
    nearbyAreas = [];
    serverResults = [];
    serverLoadMessage = err.message || "Verified apartment results could not be loaded right now.";
  }
}

async function resyncSavedQuestionnaire(answers){
  try {
    const res = await fetch("/.netlify/functions/submit-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answers),
    });
    const data = await res.json().catch(()=>({}));
    return !!(res.ok && data && data.saved);
  } catch (_e) {
    return false;
  }
}

function serverPropertyToResult(property){
  const phone = property.phone || "";
  const apt = {
    id: property.propertyId,
    name: property.name || "Apartment community",
    area: property.area || criteria.city,
    address: property.address || "",
    phone,
    phoneDisplay: phone,
    website: property.website || "",
    mapsUrl: property.directions || "",
    rating: typeof property.rating === "number" ? property.rating : null,
    reviewCount: typeof property.reviewCount === "number" ? property.reviewCount : null,
    photo: property.image || "",
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
    facts: [property.source || "Google Places"].filter(Boolean),
  };
  const reasons = Array.isArray(property.matchReasons) ? property.matchReasons : [];
  return {
    verified: apt,
    rentReady: {
      propertyId: apt.id,
      matchScore: Number(property.matchScore) || 80,
      matchReason: reasons.join(" ") || property.summary || "Matched from your saved RentReady search criteria.",
      locationSummary: property.address ? `Located near ${property.address}.` : `Located around ${criteria.city}.`,
      bestFor: property.summary || `Best for renters searching for ${criteria.style.toLowerCase()} apartments in ${criteria.city}.`,
      potentialTradeoff: property.availabilityNote || "Confirm current availability directly with the property.",
      tags: [criteria.style, criteria.city, property.website ? "Website available" : "", property.source || "Google Places"].filter(Boolean).slice(0,4),
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
  return `<span class="listing-rating">${ICONS.star} ${apt.rating.toFixed(1)}${count}</span>`;
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
  return facts.map((fact, i) => `${i ? "<span>·</span>" : ""}${fact}`).join(" ");
}
function photoHtml(apt){
  if (apt.photo) return `<img src="${apt.photo}" alt="${apt.name} exterior" loading="lazy">`;
  return `<div class="photo-placeholder" role="img" aria-label="No property photo available">${ICONS.pin}</div>`;
}
function callLineHtml(apt){
  if(apt.phone){
    return `<div class="call-line">${ICONS.phone} Call to schedule a tour: <a href="tel:${apt.phone}">${apt.phoneDisplay}</a></div>`;
  }
  return `<div class="no-phone">No phone listed — visit the property website to schedule a tour</div>`;
}
function actionButtonsHtml(apt){
  const secondary = apt.phone
    ? (apt.website ? `<a class="btn btn-secondary" href="${apt.website}" target="_blank" rel="noopener">${ICONS.globe} Check availability</a>` : apt.mapsUrl ? `<a class="btn btn-secondary" href="${apt.mapsUrl}" target="_blank" rel="noopener">${ICONS.map} Maps</a>` : "")
    : (apt.website ? `<a class="btn btn-primary" href="${apt.website}" target="_blank" rel="noopener">${ICONS.globe} Check availability</a>` : apt.mapsUrl ? `<a class="btn btn-primary" href="${apt.mapsUrl}" target="_blank" rel="noopener">${ICONS.map} View on maps</a>` : "");
  return `<div class="listing-actions">
      <button class="btn btn-primary" onclick="openPropertyModal('${apt.id}')">View apartment</button>
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
        <button class="icon-btn" type="button" aria-label="Save ${apt.name}">${ICONS.heart}</button>
        <button class="icon-btn" type="button" aria-label="Share ${apt.name}">${ICONS.share}</button>
        <button class="icon-btn" type="button" aria-label="Hide ${apt.name}">${ICONS.hide}</button>
        <button class="icon-btn" type="button" aria-label="More options for ${apt.name}">${ICONS.more}</button>
      </div>
      <span class="status-pill"><span class="status-dot"></span> Verified community</span>
    </div>
    <div class="listing-main">
      <div class="listing-top-row">
        <div class="listing-name-wrap">
          <span class="listing-name">${apt.name}</span>
          ${isTop ? `<span class="best-badge">Best match</span>` : ""}
        </div>
        <span class="match-badge">${rr.matchScore}% match</span>
      </div>
      <div class="listing-loc">${ICONS.pin} ${apt.locationLabel || apt.address || apt.area} ${ratingHtml(apt)}</div>
      <div class="listing-price">${rentRangeHtml(apt)}</div>
      ${facts ? `<div class="listing-details">${facts}</div>` : ""}
      <p class="listing-reason">${rr.matchReason}</p>
      <div class="listing-tags">${rr.tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div>
      <div class="listing-footer">
        ${callLineHtml(apt)}
        ${actionButtonsHtml(apt)}
      </div>
    </div>
  </article>`;
}

function renderHeroAndSummary(){
  document.getElementById("scLocation").textContent = criteria.city || "City needed";
  document.getElementById("scStyle").textContent = criteria.style;
  document.getElementById("scBudget").textContent = "Up to " + money(criteria.budgetMax);
  document.getElementById("scBedrooms").textContent = bedroomLabel(criteria.bedrooms);
  document.getElementById("heroSub").textContent = serverLoadMessage || (criteria.city
    ? `${currentResults.length} verified apartment communities in ${criteria.city} match your ${criteria.style.toLowerCase()}, ${bedroomLabel(criteria.bedrooms).toLowerCase()} search.`
    : "Enter a city and state to search verified apartment communities.");
  document.getElementById("nearbyCopy").textContent = nearbyAreas.length
    ? `Explore apartment communities near ${criteria.city}.`
    : `Update your city and state to search another U.S. market.`;
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
    return;
  }
  listSection.style.display = "block";
  emptySection.style.display = "none";
  document.getElementById("resultCount").textContent = currentResults.length + (currentResults.length === 1 ? " match" : " matches");
  document.getElementById("listingList").innerHTML = currentResults
    .map((r,i) => listingHtml(r, i, i < 3))
    .join("");
}

function renderAreaPills(){
  const areas = nearbyAreas.length ? nearbyAreas : [];
  document.getElementById("areaPills").innerHTML = areas.map(a => `
    <button class="area-pill ${a===criteria.area ? "active": ""}" onclick="selectArea(${jsString(a)})">${htmlEscape(a)}</button>
  `).join("");
}
function renderPrefChips(){
  document.getElementById("prefChips").innerHTML = ALL_PREFS.map(p => `
    <button type="button" class="chip-toggle ${criteria.preferences.includes(p) ? "active" : ""}" data-pref="${p}">${p}</button>
  `).join("");
  document.querySelectorAll(".chip-toggle").forEach(btn=>{
    btn.addEventListener("click", ()=> btn.classList.toggle("active"));
  });
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
  overlay.classList.remove("hide");
  overlay.classList.toggle("overlay-mode", !!overlayMode);
  const messages = ["Searching apartment communities…","Checking locations…","Comparing your preferences…","Ranking your strongest matches…","Preparing your apartment list…"];
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const step = reduced ? 0 : (overlayMode ? 250 : 440);
  let i = 0;
  bar.style.width = "6%"; statusEl.textContent = messages[0];
  const interval = setInterval(()=>{
    i++;
    bar.style.width = Math.min(96, (i+1) * (100/messages.length)) + "%";
    if(i < messages.length){
      statusEl.style.opacity = 0;
      setTimeout(()=>{ statusEl.textContent = messages[i]; statusEl.style.opacity = 1; }, reduced ? 0 : 150);
    } else {
      clearInterval(interval);
      bar.style.width = "100%";
      setTimeout(()=>{
        Promise.resolve(onDone()).finally(()=> overlay.classList.add("hide"));
      }, reduced ? 0 : 220);
    }
  }, step || 10);
}

const panelOverlay = document.getElementById("panelOverlay");
function openPanel(){
  document.getElementById("fCity").value = criteria.city;
  renderAreaSelect();
  document.getElementById("fStyle").value = criteria.style;
  document.getElementById("fBudget").value = String(criteria.budgetMax);
  document.getElementById("fBeds").value = String(criteria.bedrooms);
  renderPrefChips();
  panelOverlay.classList.add("open");
}
function closePanel(){ panelOverlay.classList.remove("open"); }
function renderAreaSelect(){
  const areaSelect = document.getElementById("fArea");
  const options = [criteria.city, ...nearbyAreas].filter(Boolean);
  const unique = Array.from(new Set(options.map(a => String(a).trim()).filter(Boolean)));
  areaSelect.innerHTML = unique.map(a => `<option value="${htmlEscape(a)}">${htmlEscape(a === criteria.city ? "Any area in " + criteria.city : a)}</option>`).join("");
  areaSelect.value = unique.includes(criteria.area) ? criteria.area : criteria.city;
}
document.getElementById("openPanelBtn").addEventListener("click", openPanel);
document.getElementById("closePanelBtn").addEventListener("click", closePanel);
panelOverlay.addEventListener("click", e => { if(e.target === panelOverlay) closePanel(); });
document.getElementById("applySearchBtn").addEventListener("click", async ()=>{
  criteria.city = document.getElementById("fCity").value.trim();
  criteria.area = document.getElementById("fArea").value || criteria.city;
  criteria.style = document.getElementById("fStyle").value;
  criteria.budgetMax = parseInt(document.getElementById("fBudget").value, 10);
  criteria.bedrooms = parseInt(document.getElementById("fBeds").value, 10);
  criteria.preferences = Array.from(document.querySelectorAll(".chip-toggle.active")).map(b=>b.dataset.pref);
  closePanel();
  runLoadingSequence(refreshResults, true);
});

function selectArea(area){ criteria.area = area; runLoadingSequence(refreshResults, true); }
document.getElementById("emptyExpandBtn").addEventListener("click", ()=>{ criteria.area = criteria.city; runLoadingSequence(refreshResults, true); });
document.getElementById("emptyAdjustBtn").addEventListener("click", openPanel);

const modalOverlay = document.getElementById("modalOverlay");
function openPropertyModal(id){
  const result = currentResults.find(r => r.verified.id === id);
  if(!result) return;
  const { verified: apt, rentReady: rr } = result;
  const webBtn = apt.website
    ? `<a class="btn btn-secondary" href="${apt.website}" target="_blank" rel="noopener">${ICONS.globe} Check availability</a>`
    : `<span class="btn btn-secondary" style="opacity:.5; pointer-events:none;">${ICONS.globe} No website listed</span>`;
  const callBlock = apt.phone
    ? `<div class="modal-call">${ICONS.phone} <span>Call to schedule a tour: <a class="num" href="tel:${apt.phone}">${apt.phoneDisplay}</a></span></div>`
    : `<div class="modal-call" style="background:var(--bg-soft);">${ICONS.warn} <span style="color:var(--ink-muted); font-weight:600;">No phone listed — use the property website to schedule a tour</span></div>`;

  document.getElementById("modalContent").innerHTML = `
    <div class="modal-photo">
      <img src="${apt.photo}" alt="${apt.name}">
      <span class="match-badge">${rr.matchScore}% match</span>
      <button class="close-x" onclick="closePropertyModal()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2.3" stroke-linecap="round"><path d="M5 5l14 14M19 5L5 19"/></svg></button>
    </div>
    <div class="modal-body">
      <div class="modal-name">${apt.name}</div>
      <div class="modal-meta"><span class="listing-loc" style="margin:0;">${ICONS.pin} ${apt.address}</span>${ratingHtml(apt)}</div>

      <div class="modal-section"><h4>Why we matched it</h4><p>${rr.matchReason}</p></div>
      <div class="modal-section"><h4>Location</h4><p>${rr.locationSummary}</p></div>
      <div class="modal-section"><h4>Best for</h4><p>${rr.bestFor}</p></div>
      <div class="modal-section"><h4>Amenities</h4><div class="listing-tags">${rr.tags.map(t=>`<span class="tag">${t}</span>`).join("")}</div></div>
      <div class="modal-section"><h4>Worth knowing</h4><div class="modal-tradeoff">${ICONS.warn} ${rr.potentialTradeoff}</div></div>

      ${callBlock}
      <div class="modal-actions">
        ${webBtn}
        <a class="btn btn-secondary" href="${apt.mapsUrl}" target="_blank" rel="noopener">${ICONS.map} View on maps</a>
      </div>
      <p class="modal-disclosure">Pricing, availability and screening requirements can change — confirm current details directly with the property before applying or paying any fees.</p>
    </div>
  `;
  modalOverlay.classList.add("open");
}
function closePropertyModal(){ modalOverlay.classList.remove("open"); }
modalOverlay.addEventListener("click", e => { if(e.target === modalOverlay) closePropertyModal(); });

window.addEventListener("load", async ()=>{
  if (!(await requireListingAccess())) return;
  applyAnswerCriteria();
  await loadVerifiedApartmentResults();
  runLoadingSequence(renderAll, false);
});
