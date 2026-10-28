/**
 * End-to-end API test through the real Netlify router (netlify/functions/api.mts) against a real SQLite
 * database (libSQL as a local SQLite test harness) with schema.sql applied. Stripe and the ESP are simulated at
 * the fetch level — no network, no charges.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { route } from '../netlify/functions/api.mts';
import { sqlDatabase } from './sqliteDatabase';
import { detectAbandonedCheckouts } from '../netlify/lib/jobs/abandoned';
import { hmacHex, type Env } from '../netlify/lib/_lib';
import { r2FileStore } from '../netlify/lib/platform';
import { DIGITAL_KIT_FILE_KEY } from '../src/config/resources';

const ORIGIN = 'https://rentready.test';
const client = createClient({ url: 'file::memory:' });
const toolkitKey = DIGITAL_KIT_FILE_KEY;
const files = new Map<string, string>([[toolkitKey, 'PK-letters']]);
const espCalls: { event: string; marketing_allowed: boolean }[] = [];
const env: Env = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_x',
  SESSION_SECRET: 'a'.repeat(64),
  ALLOWED_ORIGIN: ORIGIN,
  ESP_WEBHOOK_URL: 'https://esp.test/hook',
  ESP_WEBHOOK_SECRET: 'esp_secret_value_123',
  ADMIN_TOKEN: 'admin_token_value_1234567890',
  VIDEO_GUIDE_URL: 'https://video.test/private',
  DB: sqlDatabase(client),
  PRODUCT_FILES: {
    async createDownloadUrl(key) {
      return files.has(key) ? `https://downloads.test/${encodeURIComponent(key)}?signature=test` : null;
    },
  },
};

// ---- simulated Stripe (stateful) + ESP
const pis = new Map<string, Record<string, unknown>>();
let piSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.host === 'esp.test') {
    espCalls.push(JSON.parse(String(init?.body)));
    return new Response('{}');
  }
  if (url.host !== 'api.stripe.com') return realFetch(input, init);
  const form = new URLSearchParams(String(init?.body || ''));
  const path = url.pathname.replace('/v1/', '');
  const j = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
  if (path === 'customers') return j({ id: 'cus_test_1' });
  if (path === 'payment_intents' && init?.method === 'POST') {
    const id = `pi_test${++piSeq}`;
    const pi = {
      id, client_secret: `${id}_secret`, amount: Number(form.get('amount')), currency: form.get('currency'), customer: form.get('customer'),
      metadata: { product: form.get('metadata[product]'), lead_id: form.get('metadata[lead_id]') },
      status: form.get('confirm') === 'true' ? 'succeeded' : 'requires_payment_method', payment_method: form.get('payment_method') || 'pm_card_visa',
    };
    pis.set(id, pi);
    return j(pi);
  }
  const m = /^payment_intents\/(pi_\w+)$/.exec(path);
  if (m) return j(pis.get(m[1]));
  throw new Error(`unexpected Stripe call ${path}`);
}) as typeof fetch;

/** Browser-like client: keeps the session cookie, sends the site Origin. */
let cookie = '';
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await route(new Request(ORIGIN + path, {
    method,
    headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }), env);
  const set = res.headers.get('Set-Cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data, res };
}
const pay = (id: string) => { const p = pis.get(id)!; p.status = 'succeeded'; };
async function webhook(event: object) {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = await hmacHex(env.STRIPE_WEBHOOK_SECRET!, `${t}.${payload}`);
  return route(new Request(ORIGIN + '/api/webhooks/stripe', { method: 'POST', body: payload, headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } }), env);
}

before(async () => {
  const sql = readFileSync('schema.sql', 'utf8').replace(/--.*$/gm, '');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
    if (/^(ALTER TABLE .* ENABLE ROW LEVEL SECURITY|REVOKE ALL ON TABLE)/i.test(stmt)) continue;
    await client.execute(stmt);
  }
});

test('R2 file store signs private, attachment-only URLs that expire after five minutes', async () => {
  const accountId = 'a'.repeat(32);
  const store = r2FileStore(accountId, 'test-access-key', 'test-secret-key', 'rentready-private');
  const signedUrl = await store.createDownloadUrl(toolkitKey);
  assert.ok(signedUrl);
  const url = new URL(signedUrl);
  assert.equal(url.hostname, `${accountId}.r2.cloudflarestorage.com`);
  assert.equal(decodeURIComponent(url.pathname), `/rentready-private/${toolkitKey}`);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
  assert.ok(url.searchParams.has('X-Amz-Signature'));
  assert.equal(url.searchParams.get('response-content-disposition'), 'attachment; filename="CREDIT REPAIR TOOLKIT™.zip"');
});

test('routing: unknown path 404, wrong method 405, cross-origin POST 403, security headers set', async () => {
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('GET', '/api/leads')).status, 405);
  const bad = await route(new Request(ORIGIN + '/api/leads', { method: 'POST', headers: { Origin: 'https://evil.test' }, body: '{}' }), env);
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('Cache-Control'), 'no-store');
  assert.equal(bad.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('exit offer captures email without a name or marketing consent', async () => {
  cookie = '';
  const result = await call('POST', '/api/leads', {
    first_name: '',
    email: 'bundle-offer@example.com',
    email_consent: false,
    consent_basis: 'notice',
    consent_text: 'Email entered to continue to the offer.',
    lead_source: 'exit',
    product_interest: 'creditready',
  });
  assert.equal(result.status, 200);
  const row = (await client.execute("SELECT first_name, email_consent, product_interest FROM rr_leads WHERE email = 'bundle-offer@example.com'")).rows[0];
  assert.equal(row.first_name, '');
  assert.equal(Number(row.email_consent), 0);
  assert.equal(row.product_interest, 'creditready');
  await client.execute("DELETE FROM rr_leads WHERE email = 'bundle-offer@example.com'");
  cookie = '';
});

test('full buyer journey: lead → book → upgrade blocked/allowed → Bundle access → files → upsell → refund', async () => {
  // lead capture (+ quiz answers, progressive profiling)
  const lead = await call('POST', '/api/leads', {
    first_name: 'Jordan', email: 'Jordan@Example.com', email_consent: true, consent_basis: 'notice', consent_text: 'x', lead_source: 'checkout',
    product_interest: 'guide', qualification: { stage: 'soon30', concern: 'credit', help: 'read', intent_tier: 'medium', recommended: 'guide' },
    attribution: { utm_source: 'google', utm_campaign: 'denied' },
  });
  assert.equal(lead.status, 200);
  assert.ok(cookie.startsWith('rr_sid='), 'session cookie set');
  const again = await call('POST', '/api/leads', { first_name: 'Jordan', email: 'jordan@example.com' });
  assert.equal(again.data.lead_id, lead.data.lead_id, 'same email → same lead');
  await call('POST', '/api/leads', {
    first_name: '', email: 'jordan@example.com', email_consent: false, lead_source: 'exit', product_interest: 'creditready',
  });
  const row = (await client.execute("SELECT first_name, intent_tier, qual_stage, utm_source, email_consent FROM rr_leads WHERE email='jordan@example.com'")).rows[0];
  assert.equal(row.first_name, 'Jordan', 'email-only lead capture does not erase an existing name');
  assert.equal(row.intent_tier, 'medium', 'quiz answers kept on re-submit');
  assert.equal(row.utm_source, 'google');
  assert.equal(Number(row.email_consent), 1, 'email-only capture does not revoke prior marketing consent');

  // customer + book PaymentIntent: server decides the price
  assert.equal((await call('POST', '/api/payments/customer', { lead_id: lead.data.lead_id })).data.customer_id, 'cus_test_1');
  assert.equal((await call('POST', '/api/payments/intent', { product: 'upgrade' })).status, 409, 'upgrade needs the book');
  const book = await call('POST', '/api/payments/intent', { product: 'guide' });
  assert.equal(book.data.amount_cents, 4799);

  // verify refuses unpaid, grants paid
  assert.equal((await call('POST', '/api/payments/verify', { payment_intent_id: book.data.payment_intent_id, product: 'guide' })).data.verified, false);
  pay(book.data.payment_intent_id);
  assert.equal((await call('POST', '/api/payments/verify', { payment_intent_id: book.data.payment_intent_id, product: 'guide' })).data.verified, true);
  assert.deepEqual((await call('GET', '/api/entitlements')).data.products, ['guide']);

  // book owners can't buy the Bundle at full price or the book again; upgrade is $32
  assert.equal((await call('POST', '/api/payments/intent', { product: 'creditready' })).status, 409);
  assert.equal((await call('POST', '/api/payments/intent', { product: 'guide' })).status, 409);
  const up = await call('POST', '/api/payments/intent', { product: 'upgrade' });
  assert.equal(up.data.amount_cents, 3200);
  assert.equal(pis.get(up.data.payment_intent_id)!.metadata && (pis.get(up.data.payment_intent_id) as any).metadata.product, 'upgrade');
  assert.equal((await call('GET', `/api/files?key=${encodeURIComponent(toolkitKey)}`)).status, 403, 'no Bundle files before paying');

  // webhook is the source of truth: grants Bundle, records purchase once, forwards to ESP
  pay(up.data.payment_intent_id);
  const evt = { id: 'evt_up', type: 'payment_intent.succeeded', data: { object: pis.get(up.data.payment_intent_id) } };
  assert.equal((await webhook(evt)).status, 200);
  assert.equal((await (await webhook(evt)).json() as any).duplicate, true);
  assert.deepEqual((await call('GET', '/api/entitlements')).data.products.sort(), ['creditready', 'guide']);
  assert.equal(espCalls.filter((c) => c.event === 'purchase_completed').length, 1, 'one purchase email trigger');

  // files: authorized downloads redirect to a short-lived URL; video redirects to its private URL
  const letters = await call('GET', `/api/files?key=${encodeURIComponent(toolkitKey)}`);
  assert.equal(letters.status, 302);
  assert.match(letters.res.headers.get('Location') || '', /^https:\/\/downloads\.test\//);
  assert.equal(letters.res.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal((await call('GET', `/api/files?key=${encodeURIComponent('not-an-offered-file.zip')}`)).status, 404);
  const video = await call('GET', '/api/files?key=creditready/video-guide');
  assert.equal(video.status, 302);
  assert.equal(video.res.headers.get('Location'), env.VIDEO_GUIDE_URL);

  // upsell: saved card recorded, charged only via this endpoint, idempotent ownership
  await call('POST', '/api/payments/save-method', { payment_intent_id: up.data.payment_intent_id });
  const charge = await call('POST', '/api/upsell/charge', { product: 'playbook' }, { 'Idempotency-Key': 'k1' });
  assert.equal(charge.data.status, 'succeeded');
  assert.equal(pis.get(charge.data.payment_intent_id)!.amount, 10000);
  await webhook({ id: 'evt_pb', type: 'payment_intent.succeeded', data: { object: pis.get(charge.data.payment_intent_id) } });
  assert.ok((await call('GET', '/api/entitlements')).data.products.includes('playbook'));

  // full refund of the upgrade revokes the Bundle (book stays)
  await webhook({ id: 'evt_rf', type: 'charge.refunded', data: { object: { id: 'ch_1', customer: 'cus_test_1', amount: 3200, amount_refunded: 3200, refunded: true, currency: 'usd', metadata: {}, payment_intent: up.data.payment_intent_id } } });
  const after = (await call('GET', '/api/entitlements')).data.products;
  assert.ok(!after.includes('creditready') && after.includes('guide'));
  assert.equal(espCalls.filter((c) => c.event === 'refund_processed').length, 1);
});

test('webhook rejects a bad signature', async () => {
  const res = await route(new Request(ORIGIN + '/api/webhooks/stripe', { method: 'POST', body: '{}', headers: { 'Stripe-Signature': 't=1,v1=00' } }), env);
  assert.equal(res.status, 400);
});

test('abandoned checkout: flagged once after 60 min, never after purchase', async () => {
  cookie = '';
  const l = await call('POST', '/api/leads', { first_name: 'Sam', email: 'sam@example.com', email_consent: true });
  await call('POST', '/api/lifecycle', { event: 'checkout_started', data: { product: 'creditready' } });
  await client.execute({ sql: "UPDATE rr_lifecycle_events SET at = ? WHERE lead_id = ? AND event = 'checkout_started'", args: [new Date(Date.now() - 2 * 3600e3).toISOString(), l.data.lead_id] });
  assert.equal((await detectAbandonedCheckouts(env)).flagged, 1);
  assert.equal((await detectAbandonedCheckouts(env)).flagged, 0, 'not flagged twice');
  assert.equal((await call('POST', '/api/lifecycle', { event: 'purchase_completed' })).status, 400, 'browser cannot fake a purchase');
  // Jordan bought after checkout → never flagged
  const jordanFlags = (await client.execute("SELECT COUNT(*) AS n FROM rr_lifecycle_events e JOIN rr_leads l ON l.lead_id = e.lead_id WHERE l.email = 'jordan@example.com' AND e.event = 'checkout_abandoned'")).rows[0].n;
  assert.equal(Number(jordanFlags), 0);
});

test('unsubscribe sync + admin metrics are token-protected and add up', async () => {
  assert.equal((await route(new Request(ORIGIN + '/api/esp/unsubscribe', { method: 'POST', body: '{"email":"sam@example.com"}' }), env)).status, 401);
  const ok = await route(new Request(ORIGIN + '/api/esp/unsubscribe', { method: 'POST', body: '{"email":"sam@example.com"}', headers: { Authorization: `Bearer ${env.ESP_WEBHOOK_SECRET}` } }), env);
  assert.equal(ok.status, 200);
  assert.equal(Number((await client.execute("SELECT email_consent FROM rr_leads WHERE email='sam@example.com'")).rows[0].email_consent), 0);

  assert.equal((await call('GET', '/api/admin/metrics')).status, 401);
  const m = await call('GET', '/api/admin/metrics?days=30', undefined, { Authorization: `Bearer ${env.ADMIN_TOKEN}` });
  assert.equal(m.status, 200);
  assert.equal(m.data.leads, 2);
  const gross = m.data.products.reduce((s: number, p: any) => s + p.gross, 0);
  assert.equal(gross, 4799 + 3200 + 10000);
  assert.equal(m.data.abandoned, 1);
});
