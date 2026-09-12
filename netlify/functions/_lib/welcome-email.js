// Sends the one-time "thanks for joining" email right after a lead's
// first ($10 pre-screen) payment succeeds. Cloudflare/Resend is the
// primary delivery path because the download worker already owns the
// production email provider secrets; Apps Script remains a fallback.
const { getLead } = require('./store');
const { normalizeEmail, isValidEmail } = require('./email');

function siteBaseUrl() {
  const siteUrl = process.env.URL || process.env.DEPLOY_URL || 'https://werentreadygo.com';
  return siteUrl.replace(/\/+$/, '');
}

function cloudflareWelcomeUrl() {
  const explicit = process.env.CLOUDFLARE_WELCOME_EMAIL_URL || '';
  if (explicit) return explicit;
  const downloadUrl = process.env.CLOUDFLARE_DOWNLOAD_EMAIL_URL || '';
  return downloadUrl ? downloadUrl.replace(/\/send-download\/?$/, '/send-welcome') : '';
}

async function sendViaCloudflare({ leadId, resultsUrl }) {
  const url = cloudflareWelcomeUrl();
  if (!url) return false;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET
        ? { Authorization: `Bearer ${process.env.CLOUDFLARE_DOWNLOAD_EMAIL_SECRET}` }
        : {}),
    },
    body: JSON.stringify({ leadId, resultsUrl }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data || data.ok !== true) {
    throw new Error(`Cloudflare welcome email failed: ${JSON.stringify(data)}`);
  }
  return true;
}

async function sendWelcomeEmail(leadId) {
  const lead = await getLead(leadId);
  const email = normalizeEmail(lead && lead.email);
  if (!isValidEmail(email)) return;

  const baseUrl = siteBaseUrl();
  const resultsUrl = `${baseUrl}/after-payment-results/`;
  if (await sendViaCloudflare({ leadId, resultsUrl })) return;

  const gasUrl = process.env.GOOGLE_SCRIPT_URL;
  if (!gasUrl || gasUrl.includes('PASTE_YOUR')) return;

  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'sendWelcomeEmail',
      to: email,
      firstName: lead.first_name || '',
      subject: 'Welcome to RentReady — You’re All Set',
      resultsUrl,
      templateBaseUrl: baseUrl,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data || data.ok !== true) {
    throw new Error(`Welcome email send failed: ${JSON.stringify(data)}`);
  }
}

module.exports = { sendWelcomeEmail };
