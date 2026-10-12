// Shared by tests that call payment endpoints: builds the signed httpOnly
// session cookie those endpoints now require.
process.env.EMAIL_LINK_SECRET = process.env.EMAIL_LINK_SECRET || 'test-email-link-secret-for-unit-tests-only';
const { sign } = require('../netlify/functions/_lib/sign');

function sessionCookieHeader(leadId, scope = 'paid') {
  const token = sign({ typ: 'rrn_session', leadId, scope }, 60 * 60 * 1000);
  return `rrn_session=${encodeURIComponent(token)}`;
}

function withSession(event, leadId, scope = 'paid') {
  return { ...event, headers: { ...(event.headers || {}), cookie: sessionCookieHeader(leadId, scope) } };
}

function setCookieOf(res) {
  const h = (res && res.headers) || {};
  return h['Set-Cookie'] || h['set-cookie'] || '';
}

function sessionFromSetCookie(res) {
  const cookie = setCookieOf(res);
  const m = /rrn_session=([^;]+)/.exec(cookie);
  if (!m) return null;
  const { verify } = require('../netlify/functions/_lib/sign');
  return verify(decodeURIComponent(m[1]));
}

module.exports = { sessionCookieHeader, withSession, setCookieOf, sessionFromSetCookie };
