// Browser session for payment authorization.
//
// A leadId is NOT a credential: it shows up in URLs, localStorage and
// lookups. Anything that charges the saved card, starts a subscription,
// changes a Stripe customer or overwrites a lead checks this HttpOnly cookie.
//
// The cookie is a signed { leadId, si } pair:
//   - set by submit-lead when this browser creates a NEW lead ({ leadId })
//   - set by create-payment-intent with the SetupIntent this browser was
//     given for the trial checkout ({ leadId, si })
// A browser is the "payer" for a lead only when its cookie's `si` is the
// SetupIntent that actually saved the lead's card (recorded server-side as
// entitlements.cardSetupIntentId when the trial starts). Knowing someone's
// leadId or email is therefore never enough to charge their card.
const { sign, verify } = require('./sign');

const COOKIE_NAME = 'rr_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PURPOSE = 'session';

function sessionsEnabled() {
  return !!process.env.EMAIL_LINK_SECRET;
}

function readCookie(event, name) {
  const headers = (event && event.headers) || {};
  const header = headers.cookie || headers.Cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch (_e) {
        return '';
      }
    }
  }
  return '';
}

function readSession(event) {
  if (!sessionsEnabled()) return null;
  const token = readCookie(event, COOKIE_NAME);
  if (!token) return null;
  let data;
  try {
    data = verify(token, { purpose: PURPOSE });
  } catch (_e) {
    return null;
  }
  if (!data || typeof data.leadId !== 'string' || !data.leadId) return null;
  return { leadId: data.leadId, si: typeof data.si === 'string' ? data.si : '' };
}

function sessionForLead(event, leadId) {
  const session = readSession(event);
  return session && leadId && session.leadId === String(leadId) ? session : null;
}

// Returns a Set-Cookie header value, or null when sessions can't be signed
// (EMAIL_LINK_SECRET missing) — checkout keeps working, the browser just
// won't get one-click saved-card access.
function sessionCookie({ leadId, si }) {
  if (!sessionsEnabled() || !leadId) return null;
  const token = sign({ leadId: String(leadId), ...(si ? { si: String(si) } : {}) }, SESSION_TTL_MS, { purpose: PURPOSE });
  return [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

module.exports = { COOKIE_NAME, readSession, sessionForLead, sessionCookie, sessionsEnabled };
