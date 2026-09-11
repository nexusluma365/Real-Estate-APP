const SPREADSHEET_ID = "1EEDpYqHejXRJtRWvVLhWRIXZUi6acrvzFM_Tlaog62Q";
const SHEET_NAME = "Leads";

const HEADERS = [
  "received_at",
  "lead_id",
  "submitted_at",
  "first_name",
  "last_name",
  "email",
  "date_of_birth",
  "move_timeline",
  "preferred_city",
  "move_reason",
  "annual_income",
  "credit_score",
  "beds_needed",
  "rent_budget",
  "current_rent",
  "contact_method",
  "phone",
  "source_page",
  "referrer",
  "user_agent"
];

function doGet(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  const payload = (e && e.parameter) ? e.parameter : {};
  const callback = payload.callback;

  try {
    let response;
    if (!hasLeadData_(payload)) {
      response = {
        ok: true,
        service: "lead-capture",
        sheetName: SHEET_NAME
      };
      return callback ? jsCallbackResponse_(callback, response) : jsonResponse_(response);
    }

    response = writeLead_(payload);
    return callback ? jsCallbackResponse_(callback, response) : jsonResponse_(response);
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const payload = parsePayload_(e);

    if (payload.action === "sendEmail") {
      return jsonResponse_(sendAssetEmail_(payload));
    }

    if (payload.action === "sendWelcomeEmail") {
      return jsonResponse_(sendWelcomeEmail_(payload));
    }

    return jsonResponse_(writeLead_(payload));
  } catch (err) {
    return jsonResponse_( {
      ok: false,
      error: String(err)
    });
  } finally {
    lock.releaseLock();
  }
}

// Called by the Netlify email-asset function after it has already
// verified server-side that the purchase is real. This function's only
// job is sending the email — it does not re-check entitlement, so only
// the Netlify functions should ever call it (the URL itself is the only
// thing that needs to stay private).
function sendAssetEmail_(payload) {
  const to = String(payload.to || "").trim();
  if (!to || to.indexOf("@") === -1) {
    return { ok: false, error: "Missing or invalid recipient email." };
  }

  const firstName = payload.firstName || "there";
  const subject = payload.subject || "Your RentReady Download";
  const downloadUrl = payload.downloadUrl || "";
  const templateBaseUrl = templateBaseUrl_(payload);
  const htmlBody = renderTemplate_(fetchTemplate_(templateBaseUrl + "/rentready-emails/guide-ready-email.html"), {
    DOWNLOAD_URL: downloadUrl,
    BOOK_IMAGE_URL: templateBaseUrl + "/rentready-emails/rentready-guide-book.png",
    INSTAGRAM_URL: socialUrl_("instagram"),
    FACEBOOK_URL: socialUrl_("facebook"),
    YOUTUBE_URL: socialUrl_("youtube"),
    LINKEDIN_URL: socialUrl_("linkedin"),
    PRIVACY_URL: templateBaseUrl + "/privacy",
    TERMS_URL: templateBaseUrl + "/terms",
    SUPPORT_URL: "mailto:support@send.werentreadygo.com",
    YEAR: String(new Date().getFullYear())
  });

  const body =
    "Hi " + firstName + ",\n\n" +
    "Here is your secure download link:\n" + downloadUrl + "\n\n" +
    "This link is unique to your account and will expire after a few days " +
    "for security. If it expires, just log back in to the RentReady site " +
    "and request it again.\n\n" +
    "— RentReady Network";

  MailApp.sendEmail(to, subject, body, {
    htmlBody: htmlBody,
    name: "RentReady"
  });

  return { ok: true };
}

// Called by the Netlify confirm-intent / stripe-webhook functions once,
// right after a lead's first ($10 pre-screen) payment succeeds. Same
// caller-trust model as sendAssetEmail_ — this only sends, it does not
// re-verify the payment.
function sendWelcomeEmail_(payload) {
  const to = String(payload.to || "").trim();
  if (!to || to.indexOf("@") === -1) {
    return { ok: false, error: "Missing or invalid recipient email." };
  }

  const firstName = payload.firstName || "there";
  const subject = payload.subject || "Welcome to RentReady — You’re All Set";
  const resultsUrl = payload.resultsUrl || "";
  const templateBaseUrl = templateBaseUrl_(payload);
  const htmlBody = renderTemplate_(fetchTemplate_(templateBaseUrl + "/rentready-emails/welcome-email.html"), {
    GET_STARTED_URL: resultsUrl || templateBaseUrl + "/after-payment-results/",
    HERO_IMAGE_URL: templateBaseUrl + "/hero-bg-optimized.jpg",
    INSTAGRAM_URL: socialUrl_("instagram"),
    LINKEDIN_URL: socialUrl_("linkedin"),
    YOUTUBE_URL: socialUrl_("youtube"),
    HELP_URL: templateBaseUrl + "/",
    PRIVACY_URL: templateBaseUrl + "/privacy",
    UNSUBSCRIBE_URL: templateBaseUrl + "/",
    YEAR: String(new Date().getFullYear())
  });

  const body =
    "Hi " + firstName + ",\n\n" +
    "Thanks for joining RentReady! Your pre-screen is complete, and we're already putting together what's next for you.\n\n" +
    (resultsUrl ? "You can pick up right where you left off any time:\n" + resultsUrl + "\n\n" : "") +
    "If you have any questions along the way, just reply to this email.\n\n" +
    "— RentReady Network";

  MailApp.sendEmail(to, subject, body, {
    htmlBody: htmlBody,
    name: "RentReady"
  });

  return { ok: true };
}

function templateBaseUrl_(payload) {
  const raw = String(payload.templateBaseUrl || payload.siteUrl || "https://werentreadygo.com").trim();
  return raw.replace(/\/+$/, "");
}

function fetchTemplate_(url) {
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error("Could not load email template: " + url);
  }
  return res.getContentText();
}

function renderTemplate_(html, vars) {
  let out = String(html || "");
  Object.keys(vars).forEach(function(key) {
    out = out.split("{{" + key + "}}").join(String(vars[key] || ""));
  });
  return out;
}

function socialUrl_(network) {
  return "https://werentreadygo.com";
}

function parsePayload_(e) {
  if (!e) return {};

  if (e.postData && e.postData.contents) {
    const body = e.postData.contents;
    try {
      return JSON.parse(body);
    } catch (_err) {
      return e.parameter || {};
    }
  }

  return e.parameter || {};
}

function hasLeadData_(payload) {
  return !!(
    payload.first_name ||
    payload.last_name ||
    payload.email ||
    payload.phone
  );
}

function writeLead_(payload) {
  const sheet = getSheet_();
  ensureHeader_(sheet);

  const leadId = payload.lead_id || "";
  if (leadId && isDuplicateLeadId_(sheet, leadId)) {
    return {
      ok: true,
      message: "Lead already captured",
      deduped: true,
      lead_id: leadId
    };
  }

  const row = [
    new Date(),
    leadId,
    payload.submitted_at || "",
    payload.first_name || "",
    payload.last_name || "",
    payload.email || "",
    payload.date_of_birth || "",
    payload.move_timeline || "",
    payload.preferred_city || "",
    payload.move_reason || "",
    payload.annual_income || "",
    payload.credit_score || "",
    payload.beds_needed || "",
    payload.rent_budget || "",
    payload.current_rent || "",
    payload.contact_method || "",
    payload.phone || "",
    payload.source_page || "",
    payload.referrer || "",
    payload.user_agent || ""
  ];

  sheet.appendRow(row);

  return {
    ok: true,
    message: "Lead captured",
    lead_id: leadId
  };
}

function getSheet_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID.indexOf("PASTE_") === 0) {
    throw new Error("SPREADSHEET_ID is not configured.");
  }
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function ensureHeader_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsCallbackResponse_(callback, obj) {
  const safeCallback = String(callback).replace(/[^\w.$]/g, "");
  const body = safeCallback + "(" + JSON.stringify(obj) + ");";
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function isDuplicateLeadId_(sheet, leadId) {
  if (!leadId) return false;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;

  const ids = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(leadId)) return true;
  }
  return false;
}
