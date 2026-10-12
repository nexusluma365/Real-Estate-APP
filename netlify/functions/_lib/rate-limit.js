// Best-effort, per-function-instance sliding-window limiter for payment
// endpoints. It is a brake on rapid-fire/automated requests, not the
// duplicate-charge guarantee — that comes from Stripe idempotency plus
// one PaymentIntent per purchase (see charge-upsell.js).
const buckets = new Map();
const MAX_KEYS = 5000;

function clientIp(event) {
  const h = (event && event.headers) || {};
  return String(h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || h['client-ip'] || '').split(',')[0].trim() || 'unknown';
}

function hit(key, limit, windowMs, now = Date.now()) {
  const recent = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  if (buckets.size > MAX_KEYS) buckets.delete(buckets.keys().next().value);
  return true;
}

// rules: [{ key, limit, windowMs }]. Every rule is counted; any one over its
// limit blocks the request.
function allow(rules) {
  let ok = true;
  for (const rule of rules) {
    if (!rule.key) continue;
    if (!hit(rule.key, rule.limit, rule.windowMs)) ok = false;
  }
  return ok;
}

function reset() {
  buckets.clear();
}

module.exports = { allow, clientIp, reset };
