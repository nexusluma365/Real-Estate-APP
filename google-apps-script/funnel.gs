/**
 * RentReady funnel tracking.
 *
 * Add this as a SECOND file in the same Apps Script project (File > New >
 * Script, name it "funnel"). It reads SPREADSHEET_ID and SHEET_NAME from
 * the main script and does not change anything about the "Leads" tab.
 *
 * It adds three tabs to the same spreadsheet:
 *   Funnel          one row per visitor: furthest step, where they left off,
 *                   checkout / payment / upsell status
 *   Events          every step, timestamped (the raw history)
 *   Funnel Summary  how many people reached each step, with conversion %
 *
 * Events arrive as POST { action: "trackEvent", event, visitor_id, lead_id, ... }
 * from the Netlify functions track-event (browser steps) and
 * _lib/funnel.js (payment results confirmed by Stripe).
 */

const FUNNEL_SHEET_NAME = "Funnel";
const EVENTS_SHEET_NAME = "Events";
const SUMMARY_SHEET_NAME = "Funnel Summary";

const FUNNEL_STAGES = [
  "1. Visited site",
  "2. Started questionnaire",
  "3. Finished questionnaire",
  "4. Reached checkout",
  "5. Submitted card",
  "6. Trial started (card saved)",
  "7. Saw upsell",
  "8. Answered upsell",
  "9. Viewing apartment listings"
];

// Which stage each event proves the visitor reached.
const EVENT_STAGE = {
  page_view: 1,
  intent_landing_view: 1,
  intent_cta_click: 1,
  questionnaire_started: 2,
  questionnaire_step: 2,
  questionnaire_completed: 3,
  results_processing_viewed: 3,
  checkout_viewed: 4,
  checkout_submitted: 5,
  checkout_payment_failed: 5,
  trial_started: 6,
  results_viewed: 6,
  upsell_viewed: 7,
  upsell_clicked: 7,
  upsell_declined: 8,
  upsell_failed: 8,
  upsell_paid: 8,
  listing_preview_viewed: 9,
  full_listings_viewed: 9,
  unlock_listings_clicked: 9,
  property_contact_clicked: 9
};

const EVENT_LABELS = {
  page_view: "Viewed page",
  intent_landing_view: "Viewed landing page",
  intent_cta_click: "Clicked landing page button",
  questionnaire_started: "Started questionnaire",
  questionnaire_step: "Questionnaire question",
  questionnaire_completed: "Finished questionnaire",
  results_processing_viewed: "Saw 'matches ready' screen",
  checkout_viewed: "Viewed checkout",
  checkout_submitted: "Clicked Unlock My Matches",
  checkout_payment_failed: "Card failed at checkout",
  trial_started: "Trial started (card saved)",
  results_viewed: "Viewed results page",
  upsell_viewed: "Viewed upsell",
  upsell_clicked: "Clicked buy on upsell",
  upsell_declined: "Declined upsell",
  upsell_failed: "Upsell payment failed",
  upsell_paid: "Bought upsell",
  listing_preview_viewed: "Viewed listing preview",
  full_listings_viewed: "Viewed full listings",
  unlock_listings_clicked: "Clicked unlock listings",
  property_contact_clicked: "Contacted a property",
  subscription_paid: "Paid subscription",
  subscription_payment_failed: "Subscription payment failed",
  subscription_canceled: "Canceled subscription"
};

const FUNNEL_HEADERS = [
  "visitor_id",
  "lead_id",
  "first_name",
  "last_name",
  "email",
  "phone",
  "first_seen_at",
  "last_seen_at",
  "furthest_stage",
  "furthest_stage_no",
  "left_off_at",
  "last_page",
  "last_question",
  "questionnaire_started_at",
  "questionnaire_completed_at",
  "checkout_viewed_at",
  "checkout_submitted_at",
  "checkout_status",
  "trial_started_at",
  "payment_status",
  "first_paid_at",
  "total_paid",
  "last_payment_failed_at",
  "canceled_at",
  "upsell_viewed_at",
  "upsell_status",
  "upsell_decided_at",
  "upsell_product",
  "entry_intent",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "landing_page",
  "referrer",
  "payment_ids"
];

const EVENT_HEADERS = [
  "received_at",
  "occurred_at",
  "visitor_id",
  "lead_id",
  "event",
  "description",
  "stage",
  "step",
  "page",
  "amount",
  "source",
  "detail"
];

// Status columns only move "forward" — a returning visitor re-opening
// checkout must not turn "Trial started" back into "Viewed".
const CHECKOUT_RANK = { "Viewed": 1, "Submitted card": 2, "Card failed": 3, "Trial started": 4 };
const UPSELL_RANK = { "Viewed": 1, "Clicked buy": 2, "Declined": 3, "Payment failed": 3, "Accepted (paid)": 4 };

function trackEvent_(payload) {
  const event = String(payload.event || "");
  const visitorId = String(payload.visitor_id || "");
  const leadId = String(payload.lead_id || "");
  if (!event || (!visitorId && !leadId)) {
    return { ok: false, error: "event and visitor_id or lead_id are required." };
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const funnel = ensureFunnelSheets_(ss);
  const events = ss.getSheetByName(EVENTS_SHEET_NAME);

  const detail = (payload.detail && typeof payload.detail === "object") ? payload.detail : {};
  const now = new Date();
  const occurredAt = parseDate_(payload.occurred_at) || now;
  const stage = EVENT_STAGE[event] || 0;
  const amount = Number(payload.amount) || 0;
  const description = EVENT_LABELS[event]
    ? EVENT_LABELS[event] + ((event === "questionnaire_step" || event === "page_view") && payload.step ? ": " + payload.step : "")
    : event;

  events.appendRow([
    now,
    occurredAt,
    visitorId,
    leadId,
    event,
    description,
    stage ? FUNNEL_STAGES[stage - 1] : "",
    String(payload.step || ""),
    String(payload.page || ""),
    amount || "",
    String(payload.source || ""),
    Object.keys(detail).length ? JSON.stringify(detail) : ""
  ]);

  const found = findFunnelRow_(funnel, visitorId, leadId);
  const rowNumber = found ? found.rowNumber : funnel.getLastRow() + 1;
  const row = found ? found.values : FUNNEL_HEADERS.map(function() { return ""; });
  const col = funnelColumns_();
  const get = function(name) { return row[col[name]]; };
  const set = function(name, value) { row[col[name]] = value; };
  const setOnce = function(name, value) { if (!get(name)) set(name, value); };

  if (!found) {
    set("first_seen_at", occurredAt);
    set("payment_status", "Not paid");
    set("checkout_status", "Not reached");
    set("upsell_status", "Not offered");
  }
  if (visitorId) setOnce("visitor_id", visitorId);
  if (leadId) setOnce("lead_id", leadId);
  set("last_seen_at", occurredAt);
  if (payload.page) set("last_page", String(payload.page));

  // "Where they left off" follows the browser; payment results that arrive
  // days later (renewals, cancellations) don't overwrite it.
  if (payload.source !== "server" || stage) set("left_off_at", description);

  if (stage && stage > (Number(get("furthest_stage_no")) || 0)) {
    set("furthest_stage_no", stage);
    set("furthest_stage", FUNNEL_STAGES[stage - 1]);
  }

  ["entry_intent", "utm_source", "utm_medium", "utm_campaign", "referrer"].forEach(function(key) {
    if (detail[key]) setOnce(key, String(detail[key]));
  });
  if (event === "page_view") setOnce("landing_page", String(payload.step || payload.page || ""));

  const paymentIds = String(get("payment_ids") || "");
  const paymentId = String(payload.payment_id || "");
  const isNewPayment = !paymentId || paymentIds.split(",").indexOf(paymentId) === -1;
  if (paymentId && isNewPayment) set("payment_ids", paymentIds ? paymentIds + "," + paymentId : paymentId);

  switch (event) {
    case "questionnaire_started":
      setOnce("questionnaire_started_at", occurredAt);
      break;
    case "questionnaire_step":
      setOnce("questionnaire_started_at", occurredAt);
      set("last_question", String(payload.step || ""));
      break;
    case "questionnaire_completed":
      setOnce("questionnaire_completed_at", occurredAt);
      set("last_question", "(finished)");
      break;
    case "checkout_viewed":
      setOnce("checkout_viewed_at", occurredAt);
      raiseStatus_(row, col, "checkout_status", "Viewed", CHECKOUT_RANK);
      break;
    case "checkout_submitted":
      set("checkout_submitted_at", occurredAt);
      raiseStatus_(row, col, "checkout_status", "Submitted card", CHECKOUT_RANK);
      break;
    case "checkout_payment_failed":
      raiseStatus_(row, col, "checkout_status", "Card failed", CHECKOUT_RANK);
      break;
    case "trial_started":
      setOnce("trial_started_at", occurredAt);
      raiseStatus_(row, col, "checkout_status", "Trial started", CHECKOUT_RANK);
      if (get("payment_status") === "Not paid" || !get("payment_status")) set("payment_status", "Trial (not charged yet)");
      break;
    case "subscription_paid":
      setOnce("first_paid_at", occurredAt);
      set("payment_status", "Paid");
      if (isNewPayment) set("total_paid", (Number(get("total_paid")) || 0) + amount);
      break;
    case "subscription_payment_failed":
      set("last_payment_failed_at", occurredAt);
      set("payment_status", "Payment failed");
      break;
    case "subscription_canceled":
      set("canceled_at", occurredAt);
      set("payment_status", "Canceled");
      break;
    case "upsell_viewed":
      setOnce("upsell_viewed_at", occurredAt);
      raiseStatus_(row, col, "upsell_status", "Viewed", UPSELL_RANK);
      break;
    case "upsell_clicked":
      raiseStatus_(row, col, "upsell_status", "Clicked buy", UPSELL_RANK);
      break;
    case "upsell_declined":
      if (raiseStatus_(row, col, "upsell_status", "Declined", UPSELL_RANK)) set("upsell_decided_at", occurredAt);
      break;
    case "upsell_failed":
      if (raiseStatus_(row, col, "upsell_status", "Payment failed", UPSELL_RANK)) set("upsell_decided_at", occurredAt);
      break;
    case "upsell_paid":
      if (raiseStatus_(row, col, "upsell_status", "Accepted (paid)", UPSELL_RANK)) set("upsell_decided_at", occurredAt);
      if (detail.product) set("upsell_product", String(detail.product));
      if (isNewPayment) set("total_paid", (Number(get("total_paid")) || 0) + amount);
      break;
  }

  if (get("lead_id") && !get("email")) fillContactFromLeads_(ss, row, col);

  funnel.getRange(rowNumber, 1, 1, FUNNEL_HEADERS.length).setValues([row]);
  return { ok: true, tracked: event };
}

// Moves a status column forward (never backward). Returns true if it changed.
function raiseStatus_(row, col, name, value, ranks) {
  const current = String(row[col[name]] || "");
  if ((ranks[value] || 0) >= (ranks[current] || 0)) {
    row[col[name]] = value;
    return true;
  }
  return false;
}

function funnelColumns_() {
  const col = {};
  FUNNEL_HEADERS.forEach(function(name, i) { col[name] = i; });
  return col;
}

// Lead rows are matched by lead_id first (payment events only know the
// lead), then by visitor_id (questionnaire steps happen before a lead_id
// exists). A visitor who submits the questionnaire a second time gets a
// fresh row for the new lead.
function findFunnelRow_(sheet, visitorId, leadId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const width = FUNNEL_HEADERS.length;

  if (leadId) {
    const byLead = sheet.getRange(2, 2, lastRow - 1, 1).createTextFinder(leadId).matchEntireCell(true).findNext();
    if (byLead) {
      const r = byLead.getRow();
      return { rowNumber: r, values: sheet.getRange(r, 1, 1, width).getValues()[0] };
    }
  }
  if (visitorId) {
    const matches = sheet.getRange(2, 1, lastRow - 1, 1).createTextFinder(visitorId).matchEntireCell(true).findAll();
    for (var i = matches.length - 1; i >= 0; i--) {
      const r = matches[i].getRow();
      const values = sheet.getRange(r, 1, 1, width).getValues()[0];
      const rowLead = String(values[1] || "");
      if (!leadId || !rowLead || rowLead === leadId) return { rowNumber: r, values: values };
    }
  }
  return null;
}

// Copies name / email / phone from the Leads tab (matched by header name,
// so it works whatever order the Leads columns are in).
function fillContactFromLeads_(ss, row, col) {
  const leads = ss.getSheetByName(SHEET_NAME);
  if (!leads || leads.getLastRow() < 2) return;
  const header = leads.getRange(1, 1, 1, leads.getLastColumn()).getValues()[0].map(String);
  const leadCol = header.indexOf("lead_id");
  if (leadCol === -1) return;
  const hit = leads.getRange(2, leadCol + 1, leads.getLastRow() - 1, 1)
    .createTextFinder(String(row[col.lead_id])).matchEntireCell(true).findNext();
  if (!hit) return;
  const lead = leads.getRange(hit.getRow(), 1, 1, header.length).getValues()[0];
  ["first_name", "last_name", "email", "phone"].forEach(function(name) {
    const i = header.indexOf(name);
    if (i !== -1 && lead[i] && !row[col[name]]) row[col[name]] = lead[i];
  });
}

function parseDate_(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function ensureFunnelSheets_(ss) {
  let funnel = ss.getSheetByName(FUNNEL_SHEET_NAME);
  if (!funnel) {
    funnel = ss.insertSheet(FUNNEL_SHEET_NAME);
    funnel.appendRow(FUNNEL_HEADERS);
    funnel.setFrozenRows(1);
    funnel.getRange(1, 1, 1, FUNNEL_HEADERS.length).setFontWeight("bold");
  }
  let events = ss.getSheetByName(EVENTS_SHEET_NAME);
  if (!events) {
    events = ss.insertSheet(EVENTS_SHEET_NAME);
    events.appendRow(EVENT_HEADERS);
    events.setFrozenRows(1);
    events.getRange(1, 1, 1, EVENT_HEADERS.length).setFontWeight("bold");
  }
  if (!ss.getSheetByName(SUMMARY_SHEET_NAME)) buildSummarySheet_(ss);
  return funnel;
}

// Live formulas over the Funnel tab — no script runs needed to refresh it.
function buildSummarySheet_(ss) {
  const sheet = ss.insertSheet(SUMMARY_SHEET_NAME);
  const f = "'" + FUNNEL_SHEET_NAME + "'!";
  const stageNoCol = columnLetter_(FUNNEL_HEADERS.indexOf("furthest_stage_no") + 1);
  const checkoutCol = columnLetter_(FUNNEL_HEADERS.indexOf("checkout_status") + 1);
  const paymentCol = columnLetter_(FUNNEL_HEADERS.indexOf("payment_status") + 1);
  const upsellCol = columnLetter_(FUNNEL_HEADERS.indexOf("upsell_status") + 1);
  const totalCol = columnLetter_(FUNNEL_HEADERS.indexOf("total_paid") + 1);

  const rows = [["Step", "People who reached it", "% of all visitors", "% of previous step"]];
  FUNNEL_STAGES.forEach(function(stage, i) {
    const r = i + 2;
    rows.push([
      stage,
      "=COUNTIF(" + f + stageNoCol + ":" + stageNoCol + ",\">=" + (i + 1) + "\")",
      "=IFERROR(B" + r + "/$B$2,0)",
      i === 0 ? "" : "=IFERROR(B" + r + "/B" + (r - 1) + ",0)"
    ]);
  });
  rows.push(["", "", "", ""]);
  rows.push(["Status", "People", "", ""]);
  [
    ["Checkout: card failed", checkoutCol, "Card failed"],
    ["Checkout: trial started", checkoutCol, "Trial started"],
    ["Payment: trial, not charged yet", paymentCol, "Trial (not charged yet)"],
    ["Payment: paid", paymentCol, "Paid"],
    ["Payment: failed", paymentCol, "Payment failed"],
    ["Payment: canceled", paymentCol, "Canceled"],
    ["Upsell: viewed, no answer yet", upsellCol, "Viewed"],
    ["Upsell: accepted (paid)", upsellCol, "Accepted (paid)"],
    ["Upsell: declined", upsellCol, "Declined"],
    ["Upsell: payment failed", upsellCol, "Payment failed"]
  ].forEach(function(item) {
    rows.push([item[0], "=COUNTIF(" + f + item[1] + ":" + item[1] + ",\"" + item[2] + "\")", "", ""]);
  });
  rows.push(["Total revenue tracked ($)", "=SUM(" + f + totalCol + "2:" + totalCol + ")", "", ""]);

  sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  sheet.getRange(2, 3, FUNNEL_STAGES.length, 2).setNumberFormat("0%");
  sheet.getRange(1, 1, 1, 4).setFontWeight("bold");
  sheet.getRange(FUNNEL_STAGES.length + 3, 1, 1, 2).setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 4);
}

function columnLetter_(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Run once from the editor to create the Funnel, Events and Summary tabs up front. */
function setupFunnelSheets() {
  ensureFunnelSheets_(SpreadsheetApp.openById(SPREADSHEET_ID));
}

/** GET ?action=getFunnel&limit=500 — newest funnel rows as JSON. */
function getFunnelResponse_(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ensureFunnelSheets_(ss);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { ok: true, count: 0, rows: [] };
  var limit = parseInt(payload.limit, 10);
  if (!limit || limit < 1) limit = 500;
  const startRow = Math.max(2, lastRow - limit + 1);
  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, FUNNEL_HEADERS.length).getValues();
  const rows = values.map(function(r) {
    const out = {};
    FUNNEL_HEADERS.forEach(function(name, i) {
      out[name] = r[i] instanceof Date ? r[i].toISOString() : (r[i] === null || r[i] === undefined ? "" : String(r[i]));
    });
    return out;
  });
  rows.sort(function(a, b) { return new Date(b.last_seen_at || 0) - new Date(a.last_seen_at || 0); });
  return { ok: true, count: rows.length, rows: rows };
}
