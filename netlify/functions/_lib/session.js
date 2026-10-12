// Server-signed payment session, carried in an httpOnly cookie.
//
// A leadId on its own is NOT proof of anything — it can leak through URLs,
// emails, logs or a shared device. Every endpoint that can create a Stripe
// customer, save a card, or charge a saved card requires this cookie, and the
// lead it names is the only lead that request may act on.
//
// Scopes:
//   'lead' — issued when a lead is first created (submit-lead) or recovered
//            through a signed email link. Allows starting the card checkout
//            and updating that lead's own answers.
//   'paid' — issued once confirm-intent verifies with Stripe that the trial
//            card was saved. Required to charge the saved card (one-click
//            upsells, membership).
//
// Tokens are HMAC-signed with _lib/sign.js (EMAIL_LINK_SECRET). The cookie is
// HttpOnly (page scripts can't read it), SameSite=Lax (not sent on cross-site
// POSTs, so other sites can't trigger charges) and Secure outside local dev.
const { sign, verify } = require('./sign');

const SESSION_COOKIE = 'rrn_session';
const SESSION_TYPE = 'rrn_session';
const SCOPE_RANK = { lead: 1, paid: 2 };
const TTL_MS = {
  lead: 3 * 24 * 60 * 60 * 1000,
  paid: 7 * 24 * 60 * 60 * 1000,
};

function headerValue(headers, name) {
  if (!headers) return '';
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key] || '';
  }
  return '';
}

function parseCookies(event) {
  const out = {};
  const raw = [
    headerValue(event && event.headers, 'cookie'),
    ...(((event && event.multiValueHeaders && (event.multiValueHeaders.cookie || event.multiValueHeaders.Cookie)) || [])),
  ].filter(Boolean).join('; ');
  raw.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && !(key in out)) {
      try { out[key] = decodeURIComponent(value); } catch (_e) { out[key] = value; }
    }
  });
  return out;
}

function readSession(event) {
  const token = parseCookies(event)[SESSION_COOKIE];
  if (!token) return null;
  let data;
  try {
    data = verify(token);
  } catch (err) {
    console.error('session verify error', err.message);
    return null;
  }
  if (!data || data.typ !== SESSION_TYPE || !data.leadId || !SCOPE_RANK[data.scope]) return null;
  return { leadId: String(data.leadId), scope: data.scope, exp: data.exp };
}

function hasScope(session, scope) {
  return !!(session && SCOPE_RANK[session.scope] >= SCOPE_RANK[scope || 'lead']);
}

function sessionOwnsLead(event, leadId, scope = 'lead') {
  const session = readSession(event);
  return !!(session && hasScope(session, scope) && leadId && session.leadId === String(leadId));
}

function sessionCookie(leadId, scope = 'lead') {
  const ttl = TTL_MS[scope] || TTL_MS.lead;
  const token = sign({ typ: SESSION_TYPE, leadId: String(leadId), scope }, ttl);
  const secure = process.env.NETLIFY_DEV === 'true' ? '' : '; Secure';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${Math.floor(ttl / 1000)}; HttpOnly; SameSite=Lax${secure}`;
}

// Never downgrade: if the browser already holds a 'paid' session for this
// lead, re-issuing a 'lead' cookie would lock the customer out of one-click
// purchases they already unlocked.
function issueSessionCookie(event, leadId, scope = 'lead') {
  const current = readSession(event);
  const effective = current && current.leadId === String(leadId) && hasScope(current, scope) ? current.scope : scope;
  return sessionCookie(leadId, effective);
}

function withCookie(response, cookie) {
  if (!cookie) return response;
  return { ...response, headers: { ...(response.headers || {}), 'Set-Cookie': cookie } };
}

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) },
    body: JSON.stringify(body),
  };
}

// Returns { leadId, session } when the request is allowed, or { error } with a
// ready-to-return HTTP response. A leadId in the body is optional; if one is
// sent it must match the session, so a stale or tampered page can't act on a
// different lead.
function requireSession(event, { scope = 'lead', bodyLeadId } = {}) {
  const session = readSession(event);
  if (!session) {
    return {
      error: json(401, {
        ok: false,
        code: 'session_required',
        error: 'Your secure session has expired. Please reopen your RentReady link or start again.',
      }),
    };
  }
  if (bodyLeadId && String(bodyLeadId).trim() !== session.leadId) {
    return { error: json(403, { ok: false, code: 'session_mismatch', error: 'This session belongs to a different profile.' }) };
  }
  if (!hasScope(session, scope)) {
    return {
      error: json(403, {
        ok: false,
        code: 'session_scope',
        error: 'Complete the listing access checkout before this step.',
      }),
    };
  }
  return { leadId: session.leadId, session };
}

module.exports = {
  SESSION_COOKIE,
  parseCookies,
  readSession,
  hasScope,
  sessionOwnsLead,
  sessionCookie,
  issueSessionCookie,
  withCookie,
  requireSession,
};
