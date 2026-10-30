/**
 * End-to-end API test through the real Netlify router (netlify/functions/api.mts) against a real SQLite
 * database (libSQL as a local SQLite test harness) with schema.sql applied. Stripe and the ESP are simulated at
 * the fetch level — no network, no charges.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { approximateArea, route } from '../netlify/functions/api.mts';
import { sqlDatabase } from './sqliteDatabase';
import { detectAbandonedCheckouts } from '../netlify/lib/jobs/abandoned';
import { hmacHex, type Env } from '../netlify/lib/_lib';
import { r2FileStore } from '../netlify/lib/platform';
import { DIGITAL_KIT_FILE_KEY } from '../src/config/resources';
import { sendListingAlerts } from '../netlify/lib/jobs/alerts';
import { accessFrom } from '../netlify/lib/premium';
import { mixListings } from '../netlify/lib/listings';
import { checkedRent, enqueueArea, processQueue, quoteOnPage, safeUrl } from '../netlify/lib/scan';
import { MIGRATIONS } from '../netlify/lib/migrations';

const ORIGIN = 'https://rentready.test';
const client = createClient({ url: 'file::memory:' });
const toolkitKey = DIGITAL_KIT_FILE_KEY;
const files = new Map<string, string>([[toolkitKey, 'PK-letters']]);
const espCalls: { event: string; marketing_allowed: boolean }[] = [];
const emails: { to: string; subject: string; html: string; text: string }[] = [];
const env: Env = {
  STRIPE_SECRET_KEY: 'sk_test_x',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_x',
  SESSION_SECRET: 'a'.repeat(64),
  ALLOWED_ORIGIN: ORIGIN,
  ESP_WEBHOOK_URL: 'https://esp.test/hook',
  ESP_WEBHOOK_SECRET: 'esp_secret_value_123',
  ADMIN_TOKEN: 'admin_token_value_1234567890',
  VIDEO_GUIDE_URL: 'https://video.test/private',
  RESEND_API_KEY: 're_test_x',
  FROM_EMAIL: 'RentReady <support@send.rentready.test>',
  SUPPORT_EMAIL: 'support@rentready.test',
  GOOGLE_MAPS_API_KEY: 'g-test',
  DB: sqlDatabase(client),
  PRODUCT_FILES: {
    async createDownloadUrl(key) {
      return files.has(key) ? `https://downloads.test/${encodeURIComponent(key)}?signature=test` : null;
    },
  },
};

// ---- simulated Stripe (stateful) + ESP
const pis = new Map<string, Record<string, unknown>>();
const checkoutSessions = new Map<string, { id: string; params: Record<string, string>; status: string; customer?: string; email?: string }>();
const portalCalls: Record<string, string>[] = [];
// ---- simulated property websites + OpenAI verdicts for the second-chance scanner
let googleCalls = 0, openaiCalls = 0;
const mediaCalls: string[] = [];
const siteFetches: string[] = [];
const SITES: { id: string; name: string; website: string | null; home: string; criteria: string; verdict: Record<string, unknown> }[] = [
  { id: 'ChIJyes', name: 'Willow Point', website: 'https://willowpoint.com/', home: 'Spacious homes. 1 bedrooms starting at $1,180 per month.',
    criteria: 'Applicants with a prior eviction may be considered through our Second Chance Leasing program with an additional deposit.',
    verdict: { second_chance: 'yes', evidence_quote: 'Applicants with a prior eviction may be considered through our Second Chance Leasing program with an additional deposit.', evidence_page: 1, rent_min: 1180, rent_max: null, rent_quote: '1 bedrooms starting at $1,180 per month' } },
  { id: 'ChIJfake', name: 'Harbor Flats', website: 'https://harborflats.com/', home: 'Luxury living downtown.', criteria: 'A credit check is required for all applicants.',
    verdict: { second_chance: 'yes', evidence_quote: 'We welcome applicants with evictions and bad credit at Harbor Flats.', evidence_page: 1, rent_min: 900, rent_max: null, rent_quote: 'from $900' } },
  { id: 'ChIJno', name: 'Oak Gardens', website: 'https://oakgardens.com/', home: 'Pet friendly.', criteria: 'Applicants must have a credit score of 650.',
    verdict: { second_chance: 'no', evidence_quote: '', evidence_page: 0, rent_min: null, rent_max: null, rent_quote: '' } },
  { id: 'ChIJnoweb', name: 'No Site Commons', website: null, home: '', criteria: '', verdict: {} },
  { id: 'ChIJlocal', name: 'Sneaky Place', website: 'http://127.0.0.1/admin', home: '', criteria: '', verdict: {} },
];
let piSeq = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.host === 'esp.test') {
    espCalls.push(JSON.parse(String(init?.body)));
    return new Response('{}');
  }
  if (url.host === 'api.resend.com') {
    emails.push(JSON.parse(String(init?.body)));
    return new Response('{"id":"em_1"}');
  }
  if (url.host === 'places.googleapis.com' && url.pathname.endsWith('/media')) {
    mediaCalls.push(url.href);
    return new Response(JSON.stringify({ photoUri: `https://lh3.googleusercontent.com/tiny?w=${url.searchParams.get('maxWidthPx')}` }));
  }
  if (url.host === 'places.googleapis.com') {
    googleCalls++;
    return new Response(JSON.stringify({ places: SITES.map((x) => ({ id: x.id, displayName: { text: x.name }, formattedAddress: `${x.id} Main St, Durham, NC, USA`, nationalPhoneNumber: '(919) 555-0100', websiteUri: x.website, photos: [{ name: `places/${x.id}/photos/p1` }] })) }));
  }
  if (url.host === 'api.openai.com') {
    openaiCalls++;
    const prompt = JSON.parse(String(init?.body)).messages[1].content as string;
    const site = SITES.find((x) => prompt.startsWith(`Property: ${x.name}`))!;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(site.verdict) } }] }));
  }
  const site = SITES.find((x) => x.website && new URL(x.website).host === url.host);
  if (site) {
    siteFetches.push(url.href);
    if (url.pathname.includes('criteria')) return new Response(`<html><body><h1>Rental criteria</h1><p>${site.criteria}</p></body></html>`, { headers: { 'Content-Type': 'text/html' } });
    return new Response(`<html><body><nav><a href="/rental-criteria">Rental Criteria</a></nav><p>${site.home}</p><script>var x = "Second chance";</script></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') { siteFetches.push(url.href); return new Response('internal'); }
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
  // ---- Premium (Stripe Billing)
  if (path === 'prices') return j({ data: [{ id: 'price_premium', unit_amount: 1999, recurring: { interval: 'month' } }] });
  if (path === 'checkout/sessions' && init?.method === 'POST') {
    const id = `cs_test_${++piSeq}`;
    checkoutSessions.set(id, { id, params: Object.fromEntries(form), status: 'open' });
    return j({ id, url: `https://checkout.stripe.test/${id}` });
  }
  const csm = /^checkout\/sessions\/(cs_\w+)$/.exec(path);
  if (csm) {
    const cs = checkoutSessions.get(csm[1])!;
    return j({ id: cs.id, mode: 'subscription', status: cs.status, customer: cs.customer || 'cus_member_1',
      customer_details: { email: cs.email || 'member@example.com', name: 'Riley Member' }, metadata: { lead_id: cs.params['metadata[lead_id]'] },
      subscription: { id: 'sub_1', customer: cs.customer || 'cus_member_1', status: 'active', cancel_at_period_end: false, canceled_at: null, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } } });
  }
  if (path === 'billing_portal/configurations') return j({ data: [{ id: 'bpc_1', metadata: { rentready: 'premium' } }] });
  if (path === 'billing_portal/sessions') { portalCalls.push(Object.fromEntries(form)); return j({ url: 'https://billing.stripe.test/p/session' }); }
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

test('R2 file store signs private, attachment-only URLs that expire after 1 minute', async () => {
  const accountId = 'a'.repeat(32);
  const store = r2FileStore(accountId, 'test-access-key', 'test-secret-key', 'rentready-private');
  const signedUrl = await store.createDownloadUrl(toolkitKey);
  assert.ok(signedUrl);
  const url = new URL(signedUrl);
  assert.equal(url.hostname, `${accountId}.r2.cloudflarestorage.com`);
  assert.equal(decodeURIComponent(url.pathname), `/rentready-private/${toolkitKey}`);
  assert.equal(url.searchParams.get('X-Amz-Expires'), '60');
  assert.ok(url.searchParams.has('X-Amz-Signature'));
  assert.equal(url.searchParams.get('response-content-disposition'), `attachment; filename="CREDIT REPAIR TOOLKIT.zip"; filename*=UTF-8''${encodeURIComponent('CREDIT REPAIR TOOLKIT™.zip')}`);
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

  // receipt: sent once to the buyer; it sends them to the access page (file links expire after 1 minute, so none are emailed)
  const receipts = emails.filter((e) => e.subject.includes('receipt'));
  assert.equal(receipts.length, 1, 'one receipt email');
  assert.equal(receipts[0].to, 'jordan@example.com');
  assert.match(receipts[0].text, /\$32\.00/);
  assert.match(receipts[0].text, /https:\/\/rentready\.test\/access/, 'receipt links to the access page');
  assert.match(receipts[0].text, /1 minute/);
  assert.doesNotMatch(receipts[0].text + receipts[0].html, /\/api\/files/, 'no direct file links in email');
  // a link from an older receipt no longer downloads: it goes to sign-in
  const old = await call('GET', '/api/files?t=anything.sig', undefined, { Accept: 'text/html' });
  assert.match(old.res.headers.get('Location') || '', /\/access\?link=expired$/);

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
  assert.equal((await call('GET', `/api/files?key=${encodeURIComponent(toolkitKey)}`)).status, 403, 'refund revokes downloads');
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

test('book fulfilment: admin sees the order to ship, marks it shipped, customer emailed once', async () => {
  const auth = { Authorization: `Bearer ${env.ADMIN_TOKEN}` };
  assert.equal((await call('GET', '/api/admin/orders')).status, 401);
  // Jordan's book (guide) order ships; it was granted via verify, so record it on the lead for this check
  const list = await call('GET', '/api/admin/orders', undefined, auth);
  assert.equal(list.status, 200);
  const book = list.data.orders.find((o: any) => o.product === 'guide');
  assert.ok(book && !book.shipped, 'unshipped book order listed');
  const ship = { payment_intent_id: book.payment_intent_id, carrier: 'USPS', tracking: '9400 1000 0000', tracking_url: 'https://tools.usps.com/x' };
  assert.equal((await call('POST', '/api/admin/orders', ship, auth)).data.already_shipped, false);
  assert.equal((await call('POST', '/api/admin/orders', ship, auth)).data.already_shipped, true);
  const shipped = emails.filter((e) => e.subject.includes('shipped'));
  assert.equal(shipped.length, 1, 'one shipping email');
  assert.match(shipped[0].text, /9400 1000 0000/);
  assert.ok((await call('GET', '/api/admin/orders', undefined, auth)).data.orders.find((o: any) => o.payment_intent_id === book.payment_intent_id).shipped);
});

test('admin health reports configuration and missing files without exposing values', async () => {
  assert.equal((await call('GET', '/api/admin/health')).status, 401);
  const h = await call('GET', '/api/admin/health', undefined, { Authorization: `Bearer ${env.ADMIN_TOKEN}` });
  assert.equal(h.status, 200);
  assert.equal(h.data.settings.database, true);
  assert.match(h.data.database, /^ok/);
  assert.ok(!JSON.stringify(h.data).includes(env.STRIPE_SECRET_KEY!), 'no secret values');
});

test('a browser download without access lands on the access page with a plain-English reason', async () => {
  const res = await route(new Request(`${ORIGIN}/api/files?key=${encodeURIComponent(toolkitKey)}`, { headers: { Accept: 'text/html' } }), env);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `${ORIGIN}/access?download=signin`);
});

test('admin download test: token required, returns a fresh 1-minute toolkit link', async () => {
  assert.equal((await route(new Request(ORIGIN + '/api/admin/download-test'), env)).status, 401);
  const res = await route(new Request(ORIGIN + '/api/admin/download-test', { headers: { Authorization: `Bearer ${env.ADMIN_TOKEN}` } }), env);
  const d = (await res.json()) as { key: string; expires_in_seconds: number; url: string };
  assert.equal(res.status, 200);
  assert.equal(d.key, toolkitKey);
  assert.equal(d.expires_in_seconds, 60);
  assert.match(d.url, /^https:\/\/downloads\.test\//);
});

// ------------------------------------------------------------------ RentReady Premium
const admin = (method: string, path: string, data?: unknown) => route(new Request(ORIGIN + path, {
  method, headers: { Origin: ORIGIN, Authorization: `Bearer ${env.ADMIN_TOKEN}`, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined,
}), env);
const subEvent = (type: string, sub: Record<string, unknown>) => webhook({ id: `evt_${type}_${Math.random()}`, type, data: { object: { id: 'sub_1', customer: 'cus_member_1', cancel_at_period_end: false, canceled_at: null, items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] }, ...sub } } });

test('premium access policy: active, grace after a failed renewal, then none', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  assert.equal(accessFrom({ status: 'active', current_period_end: '2026-11-01T00:00:00Z' }, now).active, true);
  assert.equal(accessFrom({ status: 'past_due', current_period_end: '2026-11-05T00:00:00Z' }, now).active, true, 'within 7-day grace');
  assert.equal(accessFrom({ status: 'past_due', current_period_end: '2026-11-01T00:00:00Z' }, now).active, false, 'grace over');
  for (const st of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired']) assert.equal(accessFrom({ status: st, current_period_end: '2026-12-01T00:00:00Z' }, now).active, false, st);
});

test('admin listings: verified second-chance needs a source, date and screening note', async () => {
  assert.equal((await admin('POST', '/api/admin/listings', { classification: 'verified_second_chance', name: 'Elm Court', city: 'Charlotte', state: 'NC', source_name: 'Elm Court website', source_url: 'https://elm.example/criteria' })).status, 422);
  assert.equal((await admin('POST', '/api/admin/listings', { classification: 'standard', name: 'No Source', city: 'Charlotte', state: 'NC' })).status, 422);
  const ok = await admin('POST', '/api/admin/listings', {
    listing_id: 'lst_elm', classification: 'verified_second_chance', name: 'Elm Court', address: '12 Elm St', city: 'Charlotte', state: 'NC', rent_cents: 145000, beds: 2, baths: 1,
    phone: '704-555-0100', screening_note: 'Criteria page: “prior evictions older than 3 years considered case by case.”', source_name: 'Elm Court leasing criteria',
    source_url: 'https://elm.example/criteria', verified_at: '2026-10-28', photo_url: 'https://elm.example/photo.jpg',
  });
  assert.equal(ok.status, 200);
  assert.equal((await admin('POST', '/api/admin/listings', { listing_id: 'lst_oak', classification: 'standard', name: 'Oak Flats', city: 'Charlotte', state: 'NC', rent_cents: 132500, beds: 1, source_name: 'Oak Flats site', source_url: 'https://oak.example' })).status, 200);
  assert.equal((await admin('POST', '/api/admin/listings', { listing_id: 'lst_gone', classification: 'unavailable', name: 'Gone Place', city: 'Charlotte', state: 'NC', source_name: 'x', source_url: 'https://gone.example' })).status, 200);
  assert.equal((await route(new Request(ORIGIN + '/api/admin/listings'), env)).status, 401);
});

test('premium: locked listings, $5 checkout, activation, unlocked details, saving, alerts, renewal, failure, cancel', async () => {
  cookie = '';
  // Free visitor: verified listing is locked server-side (no name, address, phone, photo, source); unavailable hidden.
  const free = await call('GET', '/api/listings?place=Charlotte, NC, USA');
  assert.equal(free.status, 200);
  assert.equal(free.data.premium, false);
  assert.deepEqual(free.data.listings.map((l: any) => l.listing_id), ['lst_elm', 'lst_oak']);
  const locked = free.data.listings[0];
  assert.equal(locked.locked, true);
  assert.equal(locked.rent_cents, 145000);
  for (const k of ['name', 'address', 'phone', 'photo_url', 'source_url', 'screening_note', 'website']) assert.ok(!(k in locked), `locked listing hides ${k}`);
  assert.doesNotMatch(JSON.stringify(free.data), /Elm Court|704-555|elm\.example/, 'no premium data anywhere in the response');
  assert.equal(free.data.listings[1].name, 'Oak Flats', 'standard listings are public');
  assert.equal((await call('GET', '/api/listings/detail?id=lst_elm')).data.listing.locked, true);
  assert.equal((await call('POST', '/api/member', { action: 'save', ref: 'listing:lst_oak', label: 'Oak' })).status, 401);

  // Checkout: hosted subscription, $5 intro via once-only coupon, terms in the submit text, safe return path.
  const co = await call('POST', '/api/premium/checkout', { return_to: '/finder/?q=Charlotte%2C%20NC' });
  assert.equal(co.status, 200);
  assert.equal(co.data.intro, true);
  const cs = checkoutSessions.get(co.data.url.split('/').pop())!;
  assert.equal(cs.params.mode, 'subscription');
  assert.equal(cs.params['line_items[0][price]'], 'price_premium');
  assert.equal(cs.params['discounts[0][coupon]'], 'rentready_premium_intro');
  assert.match(cs.params['custom_text[submit][message]'], /\$5\.00 today.*\$19\.99 every month until you cancel/);
  assert.match(cs.params.success_url, /\/api\/premium\/return\?session_id=\{CHECKOUT_SESSION_ID\}&to=%2Ffinder%2F%3Fq%3DCharlotte/);
  const evil = await call('POST', '/api/premium/checkout', { return_to: '//evil.example/steal' });
  assert.match(checkoutSessions.get(evil.data.url.split('/').pop())!.params.success_url, /to=%2Ffinder%2F$/, 'open redirect refused');

  // Return before payment completes → no access.
  const pending = await call('GET', `/api/premium/return?session_id=${cs.id}&to=%2Ffinder%2F`);
  assert.match(pending.res.headers.get('Location') || '', /premium=pending$/);
  assert.equal((await call('GET', '/api/entitlements')).data.premium.active, false);

  // Paid: return confirms with Stripe, activates, signs in, and goes back to the same search.
  cs.status = 'complete';
  const ret = await call('GET', `/api/premium/return?session_id=${cs.id}&to=${encodeURIComponent('/finder/?q=Charlotte%2C%20NC')}`);
  assert.equal(ret.status, 302);
  assert.equal(ret.res.headers.get('Location'), `${ORIGIN}/finder/?q=Charlotte%2C%20NC&premium=active`);
  const ent = (await call('GET', '/api/entitlements')).data;
  assert.equal(ent.premium.active, true);
  const welcome = emails.filter((e) => e.subject === 'Welcome to RentReady Premium');
  assert.equal(welcome.length, 1);
  assert.match(welcome[0].text, /\$19\.99 per month until you cancel/);
  // The webhook for the same checkout is idempotent: no second welcome email.
  await webhook({ id: 'evt_cs_done', type: 'checkout.session.completed', data: { object: { id: cs.id, mode: 'subscription' } } });
  assert.equal(emails.filter((e) => e.subject === 'Welcome to RentReady Premium').length, 1);
  assert.equal((await call('POST', '/api/premium/checkout', {})).status, 409, 'no double membership');

  // Member: full details unlocked, saving and searches work.
  const paid = await call('GET', '/api/listings?city=charlotte&state=nc');
  assert.equal(paid.data.listings[0].locked, false);
  assert.equal(paid.data.listings[0].name, 'Elm Court');
  assert.equal(paid.data.listings[0].phone, '704-555-0100');
  assert.equal((await call('POST', '/api/member', { action: 'save', ref: 'listing:lst_elm', label: 'Elm Court', detail: '12 Elm St' })).status, 200);
  assert.equal((await call('POST', '/api/member', { action: 'viewed', ref: 'place:ChIJabc123', label: 'Some Place' })).status, 200);
  assert.equal((await call('POST', '/api/member', { action: 'save', ref: 'javascript:alert(1)', label: 'x' })).status, 400);
  const saved = await call('POST', '/api/member', { action: 'save_search', place: 'Charlotte, NC' });
  assert.equal(saved.status, 200);
  assert.equal((await call('POST', '/api/member', { action: 'save_search', place: 'Charlotte, NC' })).data.existing, true, 'no duplicate searches');
  const dash = (await call('GET', '/api/member')).data;
  assert.equal(dash.email, 'member@example.com');
  assert.deepEqual(dash.saved.map((x: any) => x.ref), ['listing:lst_elm']);
  assert.equal(dash.recent[0].ref, 'place:ChIJabc123');
  assert.equal(dash.searches[0].label, 'Charlotte, NC');

  // Alerts: a new listing is announced once; unavailable or already-sent listings never are.
  await new Promise((r) => setTimeout(r, 5));
  await admin('POST', '/api/admin/listings', { listing_id: 'lst_new', classification: 'verified_second_chance', name: 'Pine Row', city: 'Charlotte', state: 'NC', rent_cents: 120000, beds: 1, screening_note: 'Second-chance program on site.', source_name: 'Pine Row', source_url: 'https://pine.example', verified_at: '2026-10-29' });
  await admin('POST', '/api/admin/listings', { listing_id: 'lst_new_gone', classification: 'unavailable', name: 'Gone Two', city: 'Charlotte', state: 'NC', source_name: 'x', source_url: 'https://x.example' });
  assert.equal((await sendListingAlerts(env)).alerts_sent, 1);
  const alert = emails.filter((e) => e.subject === 'New apartments in Charlotte, NC');
  assert.equal(alert.length, 1);
  assert.match(alert[0].text, /Second-chance apartment · \$1,200\/mo · 1 bed/);
  assert.doesNotMatch(alert[0].text, /Gone Two|Pine Row/, 'no unavailable listings; names stay on the site');
  assert.equal((await sendListingAlerts(env)).alerts_sent, 0, 'deduplicated');
  assert.equal((await call('GET', '/api/member')).data.searches[0].new_count, 1);

  // Renewal at $19.99, then a failed payment (grace), then cancellation at period end, then the end.
  await webhook({ id: 'evt_inv_paid', type: 'invoice.paid', data: { object: { id: 'in_2', customer: 'cus_member_1', amount_paid: 1999, amount_due: 1999, billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_1' } } } } });
  assert.equal(emails.filter((e) => e.subject === 'Your RentReady Premium receipt').length, 1);
  await webhook({ id: 'evt_inv_fail', type: 'invoice.payment_failed', data: { object: { id: 'in_3', customer: 'cus_member_1', amount_paid: 0, amount_due: 1999, billing_reason: 'subscription_cycle', subscription: 'sub_1', hosted_invoice_url: 'https://invoice.stripe.test/in_3', attempt_count: 1, next_payment_attempt: Math.floor(Date.now() / 1000) + 3 * 86400 } } });
  const failMail = emails.filter((e) => e.subject.startsWith('Action needed'));
  assert.equal(failMail.length, 1);
  assert.match(failMail[0].html, /https:\/\/invoice\.stripe\.test\/in_3/, 'secure Stripe link to update payment');
  await subEvent('customer.subscription.updated', { status: 'past_due', items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) - 86400 }] } });
  assert.equal((await call('GET', '/api/entitlements')).data.premium.active, true, 'grace period');
  await subEvent('customer.subscription.updated', { status: 'active', cancel_at_period_end: true });
  assert.equal(emails.filter((e) => e.subject === 'Your RentReady Premium cancellation is confirmed').length, 1);
  assert.equal((await call('GET', '/api/entitlements')).data.premium.active, true, 'access until the paid period ends');
  const portal = await call('POST', '/api/premium/portal', { return_to: '/account' });
  assert.equal(portal.data.url, 'https://billing.stripe.test/p/session');
  assert.equal(portalCalls[0].customer, 'cus_member_1');
  assert.equal(portalCalls[0].configuration, 'bpc_1');
  await subEvent('customer.subscription.deleted', { status: 'canceled', canceled_at: Math.floor(Date.now() / 1000) });
  assert.equal(emails.filter((e) => e.subject === 'Your RentReady Premium membership has ended').length, 1);
  assert.equal((await call('GET', '/api/entitlements')).data.premium.active, false);
  assert.equal((await call('GET', '/api/listings?place=Charlotte, NC')).data.listings[0].locked, true, 'details lock again');
  assert.equal((await call('POST', '/api/member', { action: 'save', ref: 'listing:lst_oak', label: 'Oak' })).data.code, 'premium_required');
  assert.equal((await call('GET', '/api/member')).data.saved.length, 1, 'saved data kept after the membership ends');

  // Coming back: no second intro price.
  const again = await call('POST', '/api/premium/checkout', { return_to: '/account' });
  assert.equal(again.data.intro, false);
  assert.ok(!('discounts[0][coupon]' in checkoutSessions.get(again.data.url.split('/').pop())!.params));
});

test('without the Premium tables (migration not applied), buyers still get their products and the Finder still loads', async () => {
  const broken: SqlDatabase = {
    prepare(q: string) {
      if (/rr_subscriptions|rr_listings/.test(q)) return { bind: () => ({ first: () => Promise.reject(new Error('relation does not exist')), all: () => Promise.reject(new Error('relation does not exist')), run: () => Promise.reject(new Error('relation does not exist')) }) };
      return env.DB!.prepare(q);
    },
  };
  const e2 = { ...env, DB: broken };
  const res = await route(new Request(ORIGIN + '/api/entitlements', { headers: { Cookie: cookie } }), e2);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).premium.active, false);
  const l = await route(new Request(ORIGIN + '/api/listings?place=Charlotte, NC'), e2);
  assert.equal(l.status, 200);
  assert.deepEqual(((await l.json()) as any).listings, []);
});

test('sign in / sign out: a Premium-only member gets an email link, lands where they were, and other sessions see nothing of theirs', async () => {
  cookie = '';
  // member@example.com (from the Premium test) has a membership but bought no book: the link is still sent.
  const before = emails.length;
  assert.equal((await call('POST', '/api/access/link', { email: 'member@example.com', next: '/finder/?q=Charlotte%2C%20NC&listing=lst_elm' })).status, 200);
  const mail = emails.slice(before).find((e) => e.subject === 'Your RentReady sign-in link');
  assert.ok(mail, 'sign-in link emailed to a Premium member');
  const link = /(https:\/\/rentready\.test\/api\/access\/verify\?[^\s"]+)/.exec(mail!.text)![1].replace(/&amp;/g, '&');
  const v = await call('GET', link.slice(ORIGIN.length));
  assert.equal(v.res.headers.get('Location'), `${ORIGIN}/finder/?q=Charlotte%2C%20NC&listing=lst_elm`);
  assert.equal((await call('GET', '/api/member')).data.email, 'member@example.com');
  // Unknown emails get the same reply and no email (no account enumeration).
  const n = emails.length;
  assert.deepEqual((await call('POST', '/api/access/link', { email: 'nobody@example.com' })).data, { sent: true });
  assert.equal(emails.length, n);
  // next can never leave the site.
  const evil = await call('POST', '/api/access/link', { email: 'member@example.com', next: 'https://evil.example' });
  assert.equal(evil.status, 200);
  const evilMail = emails[emails.length - 1];
  const evilLink = /(https:\/\/rentready\.test\/api\/access\/verify\?[^\s"]+)/.exec(evilMail.text)![1];
  assert.equal((await call('GET', evilLink.slice(ORIGIN.length))).res.headers.get('Location'), `${ORIGIN}/access`);

  // Sign out: cookie expired, member data and premium details no longer available.
  const out = await call('POST', '/api/session/logout', {});
  assert.match(out.res.headers.get('Set-Cookie') || '', /rr_sid=;.*Max-Age=0/);
  cookie = '';
  assert.equal((await call('GET', '/api/member')).status, 401);
  assert.equal((await call('GET', '/api/entitlements')).data.premium.active, false);

  // Another visitor's session (a book buyer) never sees the member's saved apartments.
  const lead = await call('POST', '/api/leads', { first_name: 'Other', email: 'other@example.com', email_consent: false, lead_source: 'start' });
  assert.equal(lead.status, 200);
  const other = await call('GET', '/api/member');
  assert.equal(other.status, 200);
  assert.deepEqual(other.data.saved, []);
  assert.equal(other.data.email, 'other@example.com');
});

test('listing filters (server-side) and approximate area', async () => {
  cookie = '';
  const all = (await call('GET', '/api/listings?place=Charlotte, NC')).data;
  const cheap = (await call('GET', '/api/listings?place=Charlotte, NC&max_rent=1300')).data;
  assert.ok(cheap.listings.every((l: any) => l.rent_cents == null || l.rent_cents <= 130000));
  assert.equal(cheap.filtered_out, all.listings.length - cheap.listings.length);
  assert.ok(cheap.filtered_out > 0);
  const sc = (await call('GET', '/api/listings?place=Charlotte, NC&second_chance=1')).data;
  assert.ok(sc.listings.length > 0 && sc.listings.every((l: any) => l.classification === 'verified_second_chance'));
  assert.ok(sc.listings.every((l: any) => l.locked === true), 'still locked when filtered');
  const twoBeds = (await call('GET', '/api/listings?place=Charlotte, NC&beds=2')).data;
  assert.ok(twoBeds.listings.every((l: any) => l.beds == null || l.beds >= 2));
  assert.deepEqual(approximateArea({ city: 'Charlotte', subdivision: { code: 'NC' }, country: { code: 'US' } } as any), { city: 'Charlotte', state: 'NC', approximate: true });
  assert.equal(approximateArea({ city: 'Toronto', subdivision: { code: 'ON' }, country: { code: 'CA' } } as any), null);
  assert.equal(approximateArea(undefined), null);
});

test('listings mix second-chance apartments in; second-chance mode shows only them; nearby fallback is labelled', async () => {
  const c = (classification: string, id: string) => ({ classification, id }) as any;
  const mixed = mixListings([c('standard', 's1'), c('standard', 's2'), c('standard', 's3'), c('standard', 's4'), c('verified_second_chance', 'v1'), c('verified_second_chance', 'v2'), c('unknown', 'u1')]);
  assert.deepEqual(mixed.map((x: any) => x.id), ['v1', 's1', 's2', 'v2', 's3', 's4', 'u1'], 'second-chance first, then one in every three');
  assert.deepEqual(mixListings([c('verified_second_chance', 'v1'), c('verified_second_chance', 'v2'), c('standard', 's1')]).map((x: any) => x.id), ['v1', 's1', 'v2']);

  cookie = '';
  // Concord has only a standard listing: normal results add Charlotte's verified second-chance listings, flagged nearby.
  await admin('POST', '/api/admin/listings', { listing_id: 'lst_concord', classification: 'standard', name: 'Concord Commons', city: 'Concord', state: 'NC', rent_cents: 110000, beds: 1, source_name: 'Concord Commons', source_url: 'https://concord.example' });
  const concord = (await call('GET', '/api/listings?place=Concord, NC')).data;
  assert.equal(concord.listings[0].listing_id, 'lst_concord');
  const near = concord.listings.filter((l: any) => l.nearby);
  assert.ok(near.length > 0 && near.length <= 3, 'up to 3 nearby second-chance listings');
  assert.ok(near.every((l: any) => l.classification === 'verified_second_chance' && l.locked && l.city === 'Charlotte'));
  assert.doesNotMatch(JSON.stringify(near), /Elm Court|Pine Row|704-555/, 'nearby listings are locked server-side too');
  // Second-chance mode: only second-chance listings (here: the nearby ones).
  const scOnly = (await call('GET', '/api/listings?place=Concord, NC&second_chance=1')).data;
  assert.ok(scOnly.listings.length > 0 && scOnly.listings.every((l: any) => l.classification === 'verified_second_chance'));
  // A city that has its own second-chance listing gets no nearby padding.
  const clt = (await call('GET', '/api/listings?place=Charlotte, NC')).data;
  assert.ok(!clt.listings.some((l: any) => l.nearby));
  assert.equal(clt.listings[0].classification, 'verified_second_chance');
  assert.ok(clt.listings.some((l: any) => l.classification === 'standard'), 'normal results are a mix');
});

test('rent ranges: locked cards show the range only; the highest rent can’t be below the lowest', async () => {
  cookie = '';
  assert.equal((await admin('POST', '/api/admin/listings', { listing_id: 'lst_range', classification: 'verified_second_chance', name: 'Maple Row', address: '9 Maple', city: 'Gastonia', state: 'NC', rent_cents: 125000, rent_max_cents: 120000, screening_note: 'x', source_name: 'Maple', source_url: 'https://maple.example', verified_at: '2026-10-29' })).status, 422);
  assert.equal((await admin('POST', '/api/admin/listings', { listing_id: 'lst_range', classification: 'verified_second_chance', name: 'Maple Row', address: '9 Maple', city: 'Gastonia', state: 'NC', rent_cents: 125000, rent_max_cents: 160000, beds: 1, screening_note: 'Criteria page: second-chance leasing available.', source_name: 'Maple', source_url: 'https://maple.example', verified_at: '2026-10-29', phone: '704-555-0199' })).status, 200);
  const d = (await call('GET', '/api/listings?place=Gastonia, NC&second_chance=1')).data;
  const l = d.listings.find((x: any) => x.listing_id === 'lst_range');
  assert.equal(l.locked, true);
  assert.equal(l.rent_cents, 125000);
  assert.equal(l.rent_max_cents, 160000);
  assert.doesNotMatch(JSON.stringify(d), /Maple Row|9 Maple|704-555-0199|maple\.example/, 'only price range, city and beds before unlocking');
});

test('include_nearby adds same-state second-chance listings even when the city has its own', async () => {
  cookie = '';
  const d = (await call('GET', '/api/listings?place=Charlotte, NC&second_chance=1&include_nearby=1')).data;
  const own = d.listings.filter((l: any) => !l.nearby);
  const near = d.listings.filter((l: any) => l.nearby);
  assert.ok(own.length > 0 && own.every((l: any) => l.city === 'Charlotte'));
  assert.ok(near.length > 0 && near.every((l: any) => l.city !== 'Charlotte' && l.state === 'NC' && l.classification === 'verified_second_chance' && l.locked));
  assert.equal((await call('GET', '/api/listings?place=Charlotte, NC&second_chance=1')).data.listings.filter((l: any) => l.nearby).length, 0, 'not added without the flag');
});

test('embedded migrations match the .sql files; migrate endpoint is admin-only and refuses anything outside rr_', async () => {
  for (const [name, sql] of MIGRATIONS) assert.equal(sql, readFileSync(`supabase/migrations/${name}.sql`, 'utf8'), `${name} drifted`);
  assert.equal((await route(new Request(ORIGIN + '/api/admin/migrate', { method: 'POST', headers: { Origin: ORIGIN } }), env)).status, 401);
  for (const [, sql] of MIGRATIONS) {
    for (const stmt of sql.replace(/--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean)) assert.match(stmt.replace(/\s+/g, ' '), /rr_/, 'every statement targets rr_ tables');
  }
});

test('scanner safeguards: safe URLs only, quotes must be on the page, rent must be published', () => {
  for (const bad of ['http://site.com', 'https://127.0.0.1/', 'https://localhost/', 'https://[::1]/', 'https://intranet/', 'https://x.internal/', 'https://a.com:8443/', 'javascript:alert(1)', 'https://user:pw@a.com/'])
    assert.equal(safeUrl(bad), null, bad);
  assert.ok(safeUrl('https://willowpoint.com/apply'));
  const page = 'Rental criteria\nApplicants with a prior eviction may be considered through our Second Chance Leasing program.';
  assert.ok(quoteOnPage('applicants with a prior eviction may be considered through our second chance leasing program.', page));
  assert.ok(!quoteOnPage('We welcome applicants with evictions and bad credit.', page), 'invented quote rejected');
  assert.ok(!quoteOnPage('eviction', page), 'too short to be evidence');
  const v = (o: object) => ({ second_chance: 'yes', evidence_quote: '', evidence_page: 0, rent_min: null, rent_max: null, rent_quote: '', ...o }) as any;
  assert.deepEqual(checkedRent(v({ rent_min: 1250, rent_max: 1600, rent_quote: 'From $1,250 - $1,600/mo' }), [{ text: 'Floor plans From $1,250 - $1,600/mo' }]), { min: 1250, max: 1600 });
  assert.equal(checkedRent(v({ rent_min: 1250, rent_quote: 'From $1,250' }), [{ text: 'Call for pricing' }]), null, 'rent not on the page');
  assert.equal(checkedRent(v({ rent_min: 1500, rent_quote: 'From $1,250' }), [{ text: 'From $1,250' }]), null, 'number not in the quote');
});

test('second-chance scan: verified quote → listed; invented quote, no policy, no website, unsafe site → not listed; caps and re-checks', async () => {
  cookie = '';
  const e2 = { ...env, OPENAI_API_KEY: 'sk-test', GOOGLE_MAPS_API_KEY: 'g-test', SCAN_DAILY_LIMIT: '10' };
  const q1 = await enqueueArea(e2, 'Durham', 'NC');
  assert.deepEqual(q1, { status: 'queued', queued: 5 });
  assert.equal((await enqueueArea(e2, 'durham', 'nc')).status, 'recent', 'an area is queued at most once a day');
  assert.equal(googleCalls, 1);
  const r1 = await processQueue(e2, ORIGIN, 3);
  const r2 = await processQueue(e2, ORIGIN, 3);
  assert.equal((r1 as any).processed + ((r2 as any).processed ?? 0), 5);
  assert.ok(!siteFetches.some((u) => u.includes('127.0.0.1')), 'internal address never fetched');
  assert.ok(siteFetches.some((u) => u.endsWith('/rental-criteria')), 'criteria page read');

  const d = (await call('GET', '/api/listings?place=Durham, NC&second_chance=1')).data;
  assert.deepEqual(d.listings.filter((l: any) => !l.nearby).map((l: any) => l.listing_id), ['gp_ChIJyes'], 'only the property whose own site states the policy');
  assert.equal(d.listings[0].locked, true);
  assert.equal(d.listings[0].rent_cents, 118000, 'published rent kept');
  const full = (await client.execute({ sql: 'SELECT * FROM rr_listings WHERE listing_id = ?', args: ['gp_ChIJyes'] })).rows[0] as any;
  assert.match(full.screening_note, /prior eviction may be considered through our Second Chance Leasing program/);
  assert.equal(full.source_url, 'https://willowpoint.com/rental-criteria');
  assert.equal(full.source_name, 'Property website (checked automatically)');
  const scans = Object.fromEntries(((await client.execute("SELECT place_id, result FROM rr_place_scans WHERE city = 'Durham'")).rows as any[]).map((r) => [r.place_id, r.result]));
  assert.deepEqual(scans, { ChIJyes: 'second_chance', ChIJfake: 'unclear', ChIJno: 'no', ChIJnoweb: 'no_website', ChIJlocal: 'no_website' });

  // Daily cap: scans stop once SCAN_DAILY_LIMIT is reached.
  await client.execute({ sql: 'INSERT INTO rr_scan_queue (place_id, city, state, payload, enqueued_at) VALUES (?, ?, ?, ?, ?)', args: ['ChIJno', 'Durham', 'NC', JSON.stringify({ id: 'ChIJno', name: 'Oak Gardens', address: '', phone: null, website: 'https://oakgardens.com/', photo: null }), new Date().toISOString()] });
  const capped = await processQueue({ ...e2, SCAN_DAILY_LIMIT: '3' }, ORIGIN, 3);
  assert.equal((capped as any).skipped, 'daily limit reached');
  await client.execute("DELETE FROM rr_scan_queue WHERE place_id = 'ChIJno'");

  // Re-check after the TTL: the policy has been removed from the site → the listing is taken down.
  SITES[0].verdict = { second_chance: 'no', evidence_quote: '', evidence_page: 0, rent_min: null, rent_max: null, rent_quote: '' };
  await client.execute("UPDATE rr_place_scans SET scanned_at = '2026-01-01T00:00:00.000Z' WHERE place_id = 'ChIJyes'");
  await processQueue({ ...e2, SCAN_DAILY_LIMIT: '100' }, ORIGIN, 3);
  assert.equal(((await client.execute("SELECT classification FROM rr_listings WHERE listing_id = 'gp_ChIJyes'")).rows[0] as any).classification, 'unavailable');
  assert.equal((await call('GET', '/api/listings?place=Durham, NC&second_chance=1')).data.listings.filter((l: any) => !l.nearby).length, 0, 'taken down (only other cities’ listings remain, labelled nearby)');

  // Status endpoint for the page's progress message.
  const st = (await call('GET', '/api/scan/area?place=Durham, NC')).data;
  assert.deepEqual(Object.keys(st).sort(), ['checked', 'found', 'pending']);
});

test('second-chance fallback reaches other states (labelled), and locked cards get only a 48px photo preview', async () => {
  cookie = '';
  await admin('POST', '/api/admin/listings', { listing_id: 'lst_ga', classification: 'verified_second_chance', name: 'Peach Court', address: '5 Peach St', city: 'Atlanta', state: 'GA', rent_cents: 130000, screening_note: 'Second chance leasing available.', source_name: 'Peach', source_url: 'https://peach.example', verified_at: '2026-10-30', photo_url: `${ORIGIN}/finder/api/photos?name=${encodeURIComponent('places/PEACH/photos/abc')}&maxWidthPx=900` });
  // Wyoming has no listings at all: other states' verified listings are shown, flagged nearby with their own city.
  const wy = (await call('GET', '/api/listings?place=Cheyenne, WY&second_chance=1&include_nearby=1')).data;
  assert.ok(wy.listings.length > 0 && wy.listings.every((l: any) => l.nearby && l.classification === 'verified_second_chance' && l.state !== 'WY' && l.locked));
  const peach = (await call('GET', '/api/listings?place=Atlanta, GA&second_chance=1')).data.listings.find((l: any) => l.listing_id === 'lst_ga');
  assert.equal(peach.has_preview, true);
  assert.ok(!('photo_url' in peach), 'full photo url is never sent before unlocking');
  const pv = await call('GET', '/api/listings/preview?id=lst_ga');
  assert.equal(pv.status, 302);
  assert.match(pv.res.headers.get('Location') || '', /lh3\.googleusercontent\.com\/tiny\?w=48$/);
  assert.match(mediaCalls[mediaCalls.length - 1], /places\/PEACH\/photos\/abc\/media\?maxWidthPx=48/);
  assert.equal((await call('GET', '/api/listings/preview?id=lst_elm')).status, 404, 'non-Google photos get no preview');
  assert.equal((await call('GET', '/api/listings/preview?id=../../x')).status, 400);
});

