// Short-lived signed tokens for the links we email customers, so a link
// that goes out in an email isn't a permanently public URL. Requires the
// EMAIL_LINK_SECRET environment variable (any long random string).
const crypto = require('crypto');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function secret() {
  const s = process.env.EMAIL_LINK_SECRET;
  if (!s) throw new Error('EMAIL_LINK_SECRET is not set.');
  return s;
}

function sign(payloadObj, ttlMs = DEFAULT_TTL_MS) {
  const exp = Date.now() + ttlMs;
  const body = Buffer.from(JSON.stringify({ ...payloadObj, exp })).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (_err) {
    return null;
  }
  if (!data || !data.exp || Date.now() > data.exp) return null;
  return data;
}

// Encrypted (not just signed) tokens. `sign()` payloads are readable by
// anyone who base64-decodes them; `seal()` payloads are AES-256-GCM
// encrypted so values such as a Google place ID can be referenced from a
// public page without being revealed to the visitor.
function sealKey(purpose) {
  return crypto.createHash('sha256').update(`${secret()}:${purpose || 'seal'}`).digest();
}

function seal(payloadObj, ttlMs = DEFAULT_TTL_MS, purpose = 'seal') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sealKey(purpose), iv);
  const plain = Buffer.from(JSON.stringify({ ...payloadObj, exp: Date.now() + ttlMs }), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

function unseal(token, purpose = 'seal') {
  try {
    if (!token || typeof token !== 'string' || token.length > 4096) return null;
    const raw = Buffer.from(token, 'base64url');
    if (raw.length < 29) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sealKey(purpose), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    const data = JSON.parse(plain);
    if (!data || !data.exp || Date.now() > data.exp) return null;
    return data;
  } catch (_err) {
    return null;
  }
}

module.exports = { sign, verify, seal, unseal };
