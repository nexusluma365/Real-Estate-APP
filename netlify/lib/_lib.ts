import { sendTransactional } from './email';

/**
 * Shared helpers for the RentReady API (Netlify Functions — see netlify/functions/api.mts).
 * Handlers are platform-neutral: they receive `{ request, env }` and return a Response.
 * Every handler refuses (501) when its secrets/bindings are absent, so a misconfigured deploy
 * can never fabricate a success.
 */
export interface Env {
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  SESSION_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  ALLOWED_ORIGIN?: string;
  DB?: SqlDatabase; // Supabase PostgreSQL via netlify/lib/platform.ts — schema.sql
  PRODUCT_FILES?: FileStore; // Private Cloudflare R2 bucket via netlify/lib/platform.ts
  /** ESP / automation webhook (Klaviyo, Customer.io, Zapier, Make…) that receives lifecycle events. */
  ESP_WEBHOOK_URL?: string;
  /** HMAC secret for the X-RentReady-Signature header on ESP webhook calls. */
  ESP_WEBHOOK_SECRET?: string;
  /** Bearer token for /api/admin/* (the /admin dashboard). 32+ random characters. */
  ADMIN_TOKEN?: string;
  /** Private URL of the hosted step-by-step video guide. Only entitled Bundle owners are redirected to it. */
  VIDEO_GUIDE_URL?: string;
  /** Transactional email (receipts, download links, shipping updates, sign-in links) via Resend. */
  RESEND_API_KEY?: string;
  /** Verified Resend sender, e.g. "RentReady <support@send.werentreadygo.com>". */
  FROM_EMAIL?: string;
  /** Reply-to / support address shown in emails. */
  SUPPORT_EMAIL?: string;
}

/** The small database surface the handlers use (prepare → bind → first | all | run). */
declare global {
  interface SqlDatabase {
    prepare(q: string): { bind(...v: unknown[]): { first<T = unknown>(): Promise<T | null>; run(): Promise<unknown>; all<T = unknown>(): Promise<{ results: T[] }> } };
  }
  interface FileStore {
    createDownloadUrl(key: string): Promise<string | null>;
    /** Optional: whether the object is uploaded (used by /api/admin/health). */
    exists?(key: string): Promise<boolean>;
  }
}

export type Ctx = { request: Request; env: Env; params: Record<string, string> };

/** Prices live on the server. The client only ever sends a product id. */
export const PRICES = { creditready: 7999, playbook: 10000, guide: 4799, upgrade: 3200 } as const;
export type ProductId = keyof typeof PRICES;
export const isProduct = (p: unknown): p is ProductId => typeof p === 'string' && Object.prototype.hasOwnProperty.call(PRICES, p);
/** An `upgrade` order (book → Digital Bundle) grants the Digital Bundle (`creditready`) entitlement. */
export const entitlementFor = (p: ProductId): ProductId => (p === 'upgrade' ? 'creditready' : p);

/**
 * Which front-door product a customer may buy right now, given what they own. Pure — unit tested.
 * - Bundle owners can't buy the book, the Bundle or the upgrade again.
 * - Book owners can only take the credited upgrade (never pay full price for the Bundle, never re-buy the book).
 * - The upgrade requires owning the guide.
 */
export function purchaseAllowed(product: ProductId, owned: ProductId[]): boolean {
  if (product === 'playbook') return false; // sold only through /api/upsell/charge
  if (owned.includes('creditready')) return false;
  if (owned.includes('guide')) return product === 'upgrade';
  return product !== 'upgrade';
}

export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export const fail = (status: number, error: string, code = 'error') => json({ error, code }, status);
export const notConfigured = (what: string) => fail(501, `${what} is not configured on this environment.`, 'not_configured');

export async function body<T>(req: Request): Promise<T> {
  const text = await req.text();
  if (text.length > 20_000) throw new Error('payload too large');
  return JSON.parse(text || '{}') as T;
}

// ---------------------------------------------------------------- Stripe (REST, no SDK)
export async function stripe<T>(env: Env, method: 'GET' | 'POST', path: string, params?: Record<string, string>, idempotencyKey?: string): Promise<T> {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  };
  if (params && method === 'GET') Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  if (params && method === 'POST') init.body = new URLSearchParams(params).toString();
  const res = await fetch(url, init);
  const data = (await res.json()) as T & { error?: { message: string; code?: string; decline_code?: string; type?: string; payment_intent?: { id: string; client_secret: string } } };
  if (!res.ok) throw Object.assign(new Error(data.error?.message || 'Stripe error'), { stripe: data.error, status: res.status });
  return data;
}

// ---------------------------------------------------------------- signed session cookie
const enc = new TextEncoder();
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
};

export interface Session {
  lead_id: string;
  customer_id?: string;
  exp: number;
}

export async function setSession(env: Env, s: Omit<Session, 'exp'>): Promise<string> {
  const payload = btoa(JSON.stringify({ ...s, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }));
  const sig = await hmac(env.SESSION_SECRET!, payload);
  return `rr_sid=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
}

export async function getSession(req: Request, env: Env): Promise<Session | null> {
  if (!env.SESSION_SECRET) return null;
  const m = /(?:^|;\s*)rr_sid=([^;]+)/.exec(req.headers.get('Cookie') || '');
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig || !safeEqual(sig, await hmac(env.SESSION_SECRET, payload))) return null;
  try {
    const s = JSON.parse(atob(payload)) as Session;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- webhook signature
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = await hmac(secret, `${t}.${payload}`);
  return header.split(',').some((p) => p.startsWith('v1=') && safeEqual(p.slice(3), expected));
}

// ---------------------------------------------------------------- entitlements
/** Idempotent. Called by the webhook (source of truth) and the verify endpoint. */
export async function grantEntitlement(env: Env, customerId: string, product: ProductId, paymentIntentId: string, amount: number, leadId?: string) {
  if (!env.DB) throw new Error('DB binding missing');
  await env.DB.prepare(
    'INSERT INTO rr_orders (payment_intent_id, customer_id, product, amount_cents, lead_id, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
  ).bind(paymentIntentId, customerId, product, amount, leadId || null, new Date().toISOString()).run();
  // A refunded-then-repurchased product is re-activated.
  await env.DB.prepare(
    'INSERT INTO rr_entitlements (customer_id, product, granted_at) VALUES (?, ?, ?) ON CONFLICT(customer_id, product) DO UPDATE SET revoked_at = NULL',
  ).bind(customerId, entitlementFor(product), new Date().toISOString()).run();
}

// ---------------------------------------------------------------- lifecycle → ESP
export async function hmacHex(secret: string, data: string) {
  return hmac(secret, data);
}

/**
 * Records a lifecycle fact once (lead_id + event + ref is unique) and forwards it to the ESP.
 * Returns false when it was a duplicate — duplicates are never forwarded, so no duplicate emails.
 */
export async function recordLifecycle(env: Env, leadId: string, event: string, data: Record<string, unknown> = {}, ref = '') {
  if (!env.DB) return false;
  const at = new Date().toISOString();
  const r = (await env.DB.prepare('INSERT INTO rr_lifecycle_events (lead_id, event, ref, data, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .bind(leadId, event, ref, JSON.stringify(data).slice(0, 2000), at).run()) as { meta?: { changes?: number } };
  if (r?.meta?.changes === 0) return false;
  const lead = await env.DB.prepare('SELECT email, first_name, email_consent, intent_tier, recommended_product, product_interest, unsubscribed_at FROM rr_leads WHERE lead_id = ?')
    .bind(leadId).first<Lead>();
  if (!lead) return true;
  try {
    await sendTransactional(env, lead, event, data);
  } catch (e) {
    console.error('transactional email failed', event, leadId, e);
  }
  await forwardToEsp(env, leadId, lead, event, data, at);
  return true;
}

type Lead = { email: string; first_name: string; email_consent: number; intent_tier: string | null; recommended_product: string | null; product_interest: string | null; unsubscribed_at: string | null };

async function forwardToEsp(env: Env, leadId: string, lead: Lead, event: string, data: Record<string, unknown>, at: string) {
  if (!env.ESP_WEBHOOK_URL) return;
  const payload = JSON.stringify({
    event,
    at,
    lead_id: leadId,
    email: lead.email,
    first_name: lead.first_name,
    // The ESP must only send marketing/recovery mail when this is true. Transactional mail is always allowed.
    marketing_allowed: !!lead.email_consent && !lead.unsubscribed_at,
    intent_tier: lead.intent_tier,
    recommended_product: lead.recommended_product,
    product_interest: lead.product_interest,
    data,
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.ESP_WEBHOOK_SECRET) headers['X-RentReady-Signature'] = await hmac(env.ESP_WEBHOOK_SECRET, payload);
  try {
    await fetch(env.ESP_WEBHOOK_URL, { method: 'POST', headers, body: payload });
  } catch {
    /* the fact is stored; the ESP can be back-filled from lifecycle_events */
  }
}

/** Constant-time bearer check for cron/admin endpoints. */
export function bearerOk(req: Request, secret?: string) {
  if (!secret || secret.length < 16) return false;
  const h = req.headers.get('Authorization') || '';
  return safeEqual(h, `Bearer ${secret}`);
}

export async function ownedProducts(env: Env, customerId: string): Promise<ProductId[]> {
  if (!env.DB) return [];
  const r = await env.DB.prepare('SELECT product FROM rr_entitlements WHERE customer_id = ? AND revoked_at IS NULL').bind(customerId).all<{ product: ProductId }>();
  return r.results.map((x) => x.product);
}
