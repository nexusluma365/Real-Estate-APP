const assert = require('assert');
const { withSession, sessionCookieHeader, sessionFromSetCookie } = require('./_session-helper');
const { sign } = require('../netlify/functions/_lib/sign');
const session = require('../netlify/functions/_lib/session');

function mockModule(relPath, exportsObj) {
  const p = require.resolve(relPath);
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

function fresh(relPath) {
  const p = require.resolve(relPath);
  delete require.cache[p];
  return require(relPath);
}

async function sessionLibrary() {
  // Valid cookie round-trips.
  const ok = session.readSession({ headers: { cookie: sessionCookieHeader('lead_1', 'paid') } });
  assert.equal(ok.leadId, 'lead_1');
  assert.equal(ok.scope, 'paid');

  // Tampered signature -> rejected.
  const good = sessionCookieHeader('lead_1', 'paid');
  const tampered = good.slice(0, -3) + (good.endsWith('AAA') ? 'BBB' : 'AAA');
  assert.equal(session.readSession({ headers: { cookie: tampered } }), null);

  // Payload swapped to another lead (signature no longer matches) -> rejected.
  const [, value] = good.split('=');
  const [body, mac] = decodeURIComponent(value).split('.');
  const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), leadId: 'victim' })).toString('base64url');
  assert.equal(session.readSession({ headers: { cookie: `rrn_session=${forgedBody}.${mac}` } }), null);

  // An emailed link token is NOT a session, even though it's signed with the same key.
  const emailToken = sign({ product: 'apartment-results', leadId: 'lead_1' });
  assert.equal(session.readSession({ headers: { cookie: `rrn_session=${encodeURIComponent(emailToken)}` } }), null);

  // Expired -> rejected.
  const expired = sign({ typ: 'rrn_session', leadId: 'lead_1', scope: 'paid' }, -1000);
  assert.equal(session.readSession({ headers: { cookie: `rrn_session=${encodeURIComponent(expired)}` } }), null);

  // Cookie attributes.
  const cookie = session.sessionCookie('lead_1', 'paid');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\//);

  // Scope ordering and never-downgrade.
  assert.equal(session.hasScope({ scope: 'paid' }, 'lead'), true);
  assert.equal(session.hasScope({ scope: 'lead' }, 'paid'), false);
  const reissued = session.issueSessionCookie({ headers: { cookie: sessionCookieHeader('lead_1', 'paid') } }, 'lead_1', 'lead');
  assert.equal(sessionFromSetCookie({ headers: { 'Set-Cookie': reissued } }).scope, 'paid');
}

async function returnAccess() {
  const saved = [];
  const patches = [];
  const leads = {
    lead_victim: { lead_id: 'lead_victim', email: 'victim@example.com', first_name: 'Vic', phone: '7045550100', annual_income: 90000, credit_score: '750_plus', preferred_city: 'Austin, TX', rent_budget: 1800 },
  };
  let entitlements = { paid10: true, defaultPaymentMethodId: 'pm_victim', listingSubscriptionStatus: 'canceled' };
  mockModule('../netlify/functions/_lib/store', {
    getLead: async (id) => leads[id] || null,
    getEntitlements: async () => entitlements,
    saveLead: async (leadId, answers) => saved.push({ leadId, answers }),
    patchEntitlements: async (leadId, patch) => { patches.push({ leadId, patch }); return patch; },
  });
  const { handler } = fresh('../netlify/functions/return-access');

  // Preview token (anyone who typed the email) -> a NEW profile, never the victim's.
  const previewToken = sign({ product: 'apartment-results-preview', leadId: 'lead_victim' }, 60000);
  const previewRes = await handler({ httpMethod: 'GET', queryStringParameters: { token: previewToken } });
  const previewBody = JSON.parse(previewRes.body);
  assert.equal(previewRes.statusCode, 200);
  assert.notEqual(previewBody.lead.lead_id, 'lead_victim');
  assert.equal(previewBody.lead.preferred_city, 'Austin, TX');
  assert.equal(previewBody.lead.phone, undefined, 'no sensitive fields copied');
  assert.equal(previewBody.lead.annual_income, undefined);
  assert.equal(previewBody.lead.credit_score, undefined);
  const previewSession = sessionFromSetCookie(previewRes);
  assert.equal(previewSession.leadId, previewBody.lead.lead_id);
  assert.equal(previewSession.scope, 'lead');
  assert.equal(saved[0].leadId, previewBody.lead.lead_id);

  // Preview token for someone with active access -> sign in through email instead.
  entitlements = { paid10: true, defaultPaymentMethodId: 'pm_victim', listingSubscriptionStatus: 'active' };
  const activeRes = await handler({ httpMethod: 'GET', queryStringParameters: { token: previewToken } });
  assert.equal(activeRes.statusCode, 403);
  assert.equal(JSON.parse(activeRes.body).code, 'sign_in_required');
  assert.equal(sessionFromSetCookie(activeRes), null);

  // Real emailed link -> restores the paid session for that lead.
  const emailToken = sign({ product: 'apartment-results', leadId: 'lead_victim' }, 60000);
  const emailRes = await handler({ httpMethod: 'GET', queryStringParameters: { token: emailToken } });
  assert.equal(emailRes.statusCode, 200);
  assert.equal(JSON.parse(emailRes.body).lead.lead_id, 'lead_victim');
  assert.equal(sessionFromSetCookie(emailRes).scope, 'paid');

  // Garbage token -> nothing.
  const badRes = await handler({ httpMethod: 'GET', queryStringParameters: { token: 'nope' } });
  assert.equal(badRes.statusCode, 403);
}

async function membership() {
  process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
  const created = [];
  const canceled = [];
  let subscriptionResult;
  const patches = [];
  let entitlements;
  mockModule('../netlify/functions/_lib/stripe', {
    getStripe: () => ({
      subscriptions: {
        create: async (payload, options) => { created.push({ payload, options }); return subscriptionResult; },
        cancel: async (id) => { canceled.push(id); return { id }; },
        retrieve: async (id) => ({ id, status: 'active', metadata: { leadId: 'lead_m', plan: 'monthly' }, latest_invoice: { payment_intent: { status: 'succeeded' } } }),
      },
    }),
  });
  mockModule('../netlify/functions/_lib/store', {
    getEntitlements: async () => entitlements,
    getLead: async () => null,
    patchEntitlements: async (leadId, patch) => { patches.push(patch); return patch; },
  });
  const { handler } = fresh('../netlify/functions/create-subscription');
  const paid = { paid10: true, stripeCustomerId: 'cus_m', defaultPaymentMethodId: 'pm_m' };
  const req = (extra = {}) => ({ httpMethod: 'POST', body: JSON.stringify({ plan: 'monthly', leadId: 'lead_m', idempotencyKey: 'browser-random', ...extra }) });

  entitlements = paid;
  subscriptionResult = { id: 'sub_1', latest_invoice: { payment_intent: { status: 'succeeded' } } };
  assert.equal((await handler(req())).statusCode, 401, 'bare leadId cannot start a paid membership');
  assert.equal((await handler(withSession(req(), 'lead_m', 'lead'))).statusCode, 403, 'lead scope cannot charge');
  assert.equal((await handler(withSession(req(), 'other', 'paid'))).statusCode, 403, 'other lead cannot charge');
  assert.equal(created.length, 0);

  const okRes = await handler(withSession(req(), 'lead_m', 'paid'));
  assert.equal(JSON.parse(okRes.body).status, 'succeeded');
  assert.match(created[0].options.idempotencyKey, /^lead_m:membership_monthly:w\d+:a0$/);
  assert.ok(!created[0].options.idempotencyKey.includes('browser-random'));

  // Declined first invoice -> incomplete subscription cancelled, attempt recorded.
  subscriptionResult = { id: 'sub_2', latest_invoice: { payment_intent: { status: 'requires_payment_method', last_payment_error: { decline_code: 'insufficient_funds' } } } };
  const declinedBody = JSON.parse((await handler(withSession(req(), 'lead_m', 'paid'))).body);
  assert.equal(declinedBody.status, 'failed');
  assert.equal(declinedBody.reason, 'insufficient_funds');
  assert.match(declinedBody.message, /different card/);
  assert.deepEqual(canceled, ['sub_2']);
  const recorded = patches[patches.length - 1].paymentAttempts.membership_monthly;
  assert.equal(recorded.blocked, true);

  // Same card is not tried again.
  entitlements = { ...paid, paymentAttempts: { membership_monthly: recorded } };
  const before = created.length;
  const blockedBody = JSON.parse((await handler(withSession(req(), 'lead_m', 'paid'))).body);
  assert.equal(created.length, before);
  assert.equal(blockedBody.reason, 'insufficient_funds');

  // confirm-subscription also requires the paid session.
  mockModule('../netlify/functions/_lib/store', { patchEntitlements: async (l, p) => p });
  const confirm = fresh('../netlify/functions/confirm-subscription').handler;
  const confirmReq = { httpMethod: 'POST', body: JSON.stringify({ leadId: 'lead_m', subscriptionId: 'sub_1', plan: 'monthly' }) };
  assert.equal((await confirm(confirmReq)).statusCode, 401);
  assert.equal(JSON.parse((await confirm(withSession(confirmReq, 'lead_m', 'paid'))).body).status, 'succeeded');
  assert.equal((await confirm(withSession({ ...confirmReq, body: JSON.stringify({ subscriptionId: 'sub_1', plan: 'monthly' }) }, 'intruder', 'paid'))).statusCode, 403, 'subscription metadata must match the session lead');
}

(async () => {
  await sessionLibrary();
  await returnAccess();
  await membership();
  console.log('payment session security test passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
