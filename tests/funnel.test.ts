/**
 * Critical-path tests. Run: npm test  (bundles with esbuild, runs with node:test — no extra dependencies).
 * Covers: purchase eligibility, Stripe webhook signature + idempotency + entitlements + refunds,
 * analytics purchase de-duplication and values, quiz scoring/routing, objection copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- browser stubs (must exist before analytics/storage are used)
const mem = new Map<string, string>();
const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
const gtagCalls: unknown[][] = [];
Object.assign(globalThis, { window: globalThis, localStorage: storage, sessionStorage: storage, location: { pathname: '/checkout' } });
(globalThis as unknown as { gtag: (...a: unknown[]) => void }).gtag = (...a: unknown[]) => void gtagCalls.push(a);

import { hmacHex, purchaseAllowed, PRICES, verifyStripeSignature, type Env } from '../netlify/lib/_lib';
import { onRequestPost as webhook } from '../netlify/lib/api/webhooks/stripe';
import { trackPurchase } from '../src/lib/analytics';
import { intentTier, recommend } from '../src/config/qualification';
import { buyFaq } from '../src/config/faq';
import { PRODUCTS } from '../src/config/products';

// ---------------------------------------------------------------- pricing & eligibility
test('server prices match the catalogue and the upgrade credits the guide in full', () => {
  assert.equal(PRICES.guide, PRODUCTS.guide.priceCents);
  assert.equal(PRICES.creditready, PRODUCTS.creditready.priceCents);
  assert.equal(PRICES.playbook, PRODUCTS.playbook.priceCents);
  assert.equal(PRICES.upgrade, PRICES.creditready - PRICES.guide);
  assert.equal(PRICES.upgrade, 3200);
  assert.equal(PRICES.creditready, 7999, 'Digital Bundle $79.99');
  assert.equal(PRICES.guide, 4799, 'book $47.99');
});

test('purchaseAllowed never sells something already owned', () => {
  assert.equal(purchaseAllowed('guide', []), true);
  assert.equal(purchaseAllowed('creditready', []), true);
  assert.equal(purchaseAllowed('upgrade', []), false, 'upgrade requires the guide');
  assert.equal(purchaseAllowed('upgrade', ['guide']), true);
  assert.equal(purchaseAllowed('creditready', ['guide']), false, 'guide owners get the credited price');
  assert.equal(purchaseAllowed('guide', ['guide']), false);
  assert.equal(purchaseAllowed('guide', ['creditready']), false);
  assert.equal(purchaseAllowed('upgrade', ['guide', 'creditready']), false);
  assert.equal(purchaseAllowed('playbook', ['creditready']), false, 'playbook only via upsell endpoint');
});

// ---------------------------------------------------------------- webhook (fake database)
type Row = Record<string, unknown>;
function fakeDb() {
  const t = { webhook_events: [] as Row[], orders: [] as Row[], entitlements: [] as Row[], lifecycle_events: [] as Row[] };
  const db = {
    t,
    prepare(sql: string) {
      const q = sql.replace(/\s+/g, ' ').trim();
      return {
        bind(...v: unknown[]) {
          const run = async () => {
            if (q.startsWith('INSERT INTO webhook_events')) t.webhook_events.push({ id: v[0] });
            else if (q.startsWith('INSERT OR IGNORE INTO orders')) {
              if (!t.orders.some((o) => o.payment_intent_id === v[0])) t.orders.push({ payment_intent_id: v[0], customer_id: v[1], product: v[2], amount_cents: v[3], lead_id: v[4] });
            } else if (q.startsWith('INSERT INTO entitlements')) {
              const e = t.entitlements.find((x) => x.customer_id === v[0] && x.product === v[1]);
              if (e) e.revoked_at = null;
              else t.entitlements.push({ customer_id: v[0], product: v[1], revoked_at: null });
            } else if (q.startsWith('INSERT OR IGNORE INTO lifecycle_events')) {
              if (t.lifecycle_events.some((x) => x.lead_id === v[0] && x.event === v[1] && x.ref === v[2])) return { meta: { changes: 0 } };
              t.lifecycle_events.push({ lead_id: v[0], event: v[1], ref: v[2], data: v[3] });
            } else if (q.startsWith('UPDATE orders SET refunded_cents')) {
              const o = t.orders.find((x) => x.payment_intent_id === v[2]);
              if (o) Object.assign(o, { refunded_cents: v[0], refunded_at: v[1] });
            } else if (q.startsWith('UPDATE entitlements SET revoked_at')) {
              t.entitlements.filter((x) => x.customer_id === v[1] && x.product === v[2]).forEach((x) => (x.revoked_at = v[0]));
            } else throw new Error(`fake DB: unhandled run ${q}`);
            return { meta: { changes: 1 } };
          };
          const first = async () => {
            if (q.startsWith('SELECT id FROM webhook_events')) return t.webhook_events.find((x) => x.id === v[0]) || null;
            if (q.startsWith('SELECT product, lead_id, amount_cents FROM orders')) return t.orders.find((x) => x.payment_intent_id === v[0]) || null;
            if (q.startsWith('SELECT email')) return null;
            throw new Error(`fake DB: unhandled first ${q}`);
          };
          return { run, first, all: async () => ({ results: [] }) };
        },
      };
    },
  };
  return db;
}

const SECRET = 'whsec_test_secret_value';
async function signed(body: object, secret = SECRET, t = Math.floor(Date.now() / 1000)) {
  const payload = JSON.stringify(body);
  const sig = await hmacHex(secret, `${t}.${payload}`);
  return new Request('https://x.test/api/webhooks/stripe', { method: 'POST', body: payload, headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } });
}
const pi = (id: string, product: string, amount: number) => ({
  id: `evt_${id}`, type: 'payment_intent.succeeded',
  data: { object: { id: `pi_${id}`, customer: 'cus_1', amount, currency: 'usd', metadata: { product, lead_id: 'lead_1' } } },
});

test('stripe signature: valid accepted, tampered / wrong secret / stale rejected', async () => {
  const t = Math.floor(Date.now() / 1000);
  const payload = '{"a":1}';
  const sig = await hmacHex(SECRET, `${t}.${payload}`);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, SECRET), true);
  assert.equal(await verifyStripeSignature('{"a":2}', `t=${t},v1=${sig}`, SECRET), false);
  assert.equal(await verifyStripeSignature(payload, `t=${t},v1=${sig}`, 'whsec_other'), false);
  const old = t - 3600;
  assert.equal(await verifyStripeSignature(payload, `t=${old},v1=${await hmacHex(SECRET, `${old}.${payload}`)}`, SECRET), false);
  assert.equal(await verifyStripeSignature(payload, null, SECRET), false);
});

test('webhook: bad signature → 400 and nothing granted', async () => {
  const DB = fakeDb();
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, DB } as unknown as Env;
  const res = await webhook({ request: await signed(pi('a', 'guide', 4799), 'whsec_wrong'), env, params: {} });
  assert.equal(res.status, 400);
  assert.equal(DB.t.entitlements.length, 0);
});

test('webhook: purchase grants entitlement once, records one purchase_completed, ignores replays', async () => {
  const DB = fakeDb();
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, DB } as unknown as Env;
  const evt = pi('b', 'guide', 4799);
  assert.equal((await webhook({ request: await signed(evt), env, params: {} })).status, 200);
  const replay = await (await webhook({ request: await signed(evt), env, params: {} })).json();
  assert.equal((replay as { duplicate?: boolean }).duplicate, true);
  assert.deepEqual(DB.t.entitlements.map((e) => e.product), ['guide']);
  assert.equal(DB.t.orders.length, 1);
  assert.equal(DB.t.lifecycle_events.filter((e) => e.event === 'purchase_completed').length, 1);
});

test('webhook: wrong amount for product is NOT granted', async () => {
  const DB = fakeDb();
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, DB } as unknown as Env;
  await webhook({ request: await signed(pi('c', 'creditready', 17999)), env, params: {} }); // old Kit price must not grant
  assert.equal(DB.t.entitlements.length, 0);
});

test('webhook: upgrade order grants the Digital Bundle entitlement; full refund revokes it', async () => {
  const DB = fakeDb();
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, DB } as unknown as Env;
  await webhook({ request: await signed(pi('d', 'upgrade', 3200)), env, params: {} });
  assert.deepEqual(DB.t.orders.map((o) => o.product), ['upgrade']);
  assert.deepEqual(DB.t.entitlements.map((e) => [e.product, e.revoked_at]), [['creditready', null]]);
  const refund = { id: 'evt_r', type: 'charge.refunded', data: { object: { id: 'ch_1', customer: 'cus_1', amount: 3200, amount_refunded: 3200, refunded: true, currency: 'usd', metadata: {}, payment_intent: 'pi_d' } } };
  await webhook({ request: await signed(refund), env, params: {} });
  assert.ok(DB.t.entitlements[0].revoked_at, 'entitlement revoked');
  assert.equal(DB.t.orders[0].refunded_cents, 3200);
  assert.equal(DB.t.lifecycle_events.filter((e) => e.event === 'refund_processed').length, 1);
});

test('webhook: partial refund keeps access', async () => {
  const DB = fakeDb();
  const env = { STRIPE_WEBHOOK_SECRET: SECRET, DB } as unknown as Env;
  await webhook({ request: await signed(pi('e', 'creditready', 7999)), env, params: {} });
  const refund = { id: 'evt_pr', type: 'charge.refunded', data: { object: { id: 'ch_2', customer: 'cus_1', amount: 7999, amount_refunded: 1000, refunded: false, currency: 'usd', metadata: {}, payment_intent: 'pi_e' } } };
  await webhook({ request: await signed(refund), env, params: {} });
  assert.equal(DB.t.entitlements[0].revoked_at, null);
});

// ---------------------------------------------------------------- analytics
test('trackPurchase reports the verified amount and never double-counts a transaction', () => {
  gtagCalls.length = 0;
  assert.equal(trackPurchase('front', 'guide', 4799, 'pi_tx1'), true);
  assert.equal(trackPurchase('front', 'guide', 4799, 'pi_tx1'), false, 'reload / back button must not re-report');
  const purchases = gtagCalls.filter((c) => c[0] === 'event' && c[1] === 'purchase');
  assert.equal(purchases.length, 1);
  const p = purchases[0][2] as { value: number; currency: string; transaction_id: string };
  assert.equal(p.value, 47.99);
  assert.equal(p.currency, 'USD');
  assert.equal(p.transaction_id, 'pi_tx1');
  trackPurchase('front', 'creditready', 7999, 'pi_tx2');
  trackPurchase('upsell', 'playbook', 10000, 'pi_tx3');
  const values = gtagCalls.filter((c) => c[1] === 'purchase').map((c) => (c[2] as { value: number }).value);
  assert.deepEqual(values, [47.99, 79.99, 100]);
});

test('analytics payloads never contain quiz answers, email or name', () => {
  const blob = JSON.stringify(gtagCalls);
  assert.ok(!/@|stage|concern|first_name|email/.test(blob), blob);
});

// ---------------------------------------------------------------- qualification
test('intent tier uses only timeline + help wanted', () => {
  assert.equal(intentTier({ stage: 'soon7', help: 'system' }), 'high');
  assert.equal(intentTier({ stage: 'denied', help: 'read' }), 'high');
  assert.equal(intentTier({ stage: 'soon30', help: 'free' }), 'medium');
  assert.equal(intentTier({ stage: 'research', help: 'free' }), 'early');
  assert.equal(intentTier({ stage: 'research', concern: 'credit', help: 'free' }), 'early', 'concern never changes the tier');
});

test('recommendation routing', () => {
  assert.equal(recommend({ help: 'system' }).primary, 'creditready');
  assert.equal(recommend({ help: 'read' }).primary, 'guide');
  assert.equal(recommend({ help: 'free' }).primary, 'checklist');
  assert.equal(recommend({ stage: 'denied', help: 'why' }).primary, 'creditready');
  assert.equal(recommend({ stage: 'research', concern: 'credit', help: 'why' }).primary, 'guide');
});

// ---------------------------------------------------------------- copy accuracy
test('objection answers follow config (refund window, prices)', () => {
  const base = { guidePrice: '$47.99', bundlePrice: '$79.99', upgradePrice: '$32', deliveryNote: '', supportEmail: 's@x.com' };
  const on = buyFaq({ ...base, refundDays: 30 });
  assert.match(on.find((f) => f.id === 'refund')!.a, /within 30 days/);
  const off = buyFaq({ ...base, refundDays: 0 });
  assert.doesNotMatch(off.find((f) => f.id === 'refund')!.a, /days of purchase/);
  assert.match(on.find((f) => f.id === 'which-one')!.a, /\$47\.99[\s\S]*\$79\.99[\s\S]*\$32/);
  assert.match(on.find((f) => f.id === 'physical')!.a, /physical book/);
  assert.ok(on.every((f) => !/guarantee (you|your) (approval|will be approved)/i.test(f.a)));
});
