// Sends the one-time "thanks for joining" email right after a lead's
// first ($10 pre-screen) payment succeeds. Reuses the same Google Apps
// Script web app the questionnaire and asset emails already go through,
// so no new email provider/config is needed. Callers decide *whether*
// this is the lead's first prescreen payment (by checking entitlements
// before patching them) — this function just sends, once asked to.
const { getLead } = require('./store');
const { normalizeEmail, isValidEmail } = require('./email');

async function sendWelcomeEmail(leadId) {
  const gasUrl = process.env.GOOGLE_SCRIPT_URL;
  if (!gasUrl || gasUrl.includes('PASTE_YOUR')) return;

  const lead = await getLead(leadId);
  const email = normalizeEmail(lead && lead.email);
  if (!isValidEmail(email)) return;

  const siteUrl = process.env.URL || process.env.DEPLOY_URL || '';
  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'sendWelcomeEmail',
      to: email,
      firstName: lead.first_name || '',
      subject: 'Welcome to RentReady — You’re All Set',
      resultsUrl: siteUrl ? `${siteUrl}/after-payment-results/` : '',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data || data.ok !== true) {
    throw new Error(`Welcome email send failed: ${JSON.stringify(data)}`);
  }
}

module.exports = { sendWelcomeEmail };
