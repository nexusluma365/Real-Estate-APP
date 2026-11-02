/**
 * RentReady — apartment-match questionnaire → Google Sheet.
 * Paste into Extensions → Apps Script of the Google Sheet that should receive answers, set SECRET, then
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone). See README.md in this folder.
 * Only requests carrying SECRET can add rows; the RentReady server sends it, browsers never see it.
 */
const SECRET = 'PASTE-THE-SAME-LONG-RANDOM-SECRET-AS-NETLIFY';
const SHEET_NAME = 'Questionnaire';
const COLUMNS = [
  ['submitted_at', 'Submitted (UTC)'], ['first_name', 'First name'], ['email', 'Email'], ['marketing_opt_in', 'Marketing opt-in'],
  ['location', 'City / ZIP'], ['move_timing', 'Move timing'], ['budget', 'Budget'], ['bedrooms', 'Bedrooms'],
  ['rental_concerns', 'Rental concerns'], ['premium_member', 'Customer'], ['lead_id', 'Lead ID'],
  ['utm_source', 'UTM source'], ['utm_medium', 'UTM medium'], ['utm_campaign', 'UTM campaign'], ['gclid', 'Google Ads click'],
];

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!SECRET || SECRET.indexOf('PASTE-') === 0 || body.secret !== SECRET) return reply({ ok: false, error: 'unauthorized' });
    const row = body.row || {};
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
      if (sheet.getLastRow() === 0) {
        sheet.appendRow(COLUMNS.map(function (c) { return c[1]; }));
        sheet.setFrozenRows(1);
        sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
      }
      sheet.appendRow(COLUMNS.map(function (c) { return safe(row[c[0]]); }));
    } finally {
      lock.releaseLock();
    }
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

/** Keep every value as plain text: cells starting with = + - @ would otherwise run as formulas. */
function safe(v) {
  const s = v === undefined || v === null ? '' : String(v).slice(0, 300);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
