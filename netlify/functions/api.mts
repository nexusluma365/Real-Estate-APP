import type { Config, Context } from '@netlify/functions';
import { fail, type Ctx, type Env } from '../lib/_lib';
import { netlifyEnv } from '../lib/platform';
import * as leads from '../lib/api/leads';
import * as events from '../lib/api/events';
import * as lifecycle from '../lib/api/lifecycle';
import * as entitlements from '../lib/api/entitlements';
import * as assessment from '../lib/api/assessment';
import * as files from '../lib/api/files';
import * as customer from '../lib/api/payments/customer';
import * as intent from '../lib/api/payments/intent';
import * as verify from '../lib/api/payments/verify';
import * as saveMethod from '../lib/api/payments/save-method';
import * as attach from '../lib/api/payments/attach';
import * as upsell from '../lib/api/upsell/charge';
import * as webhook from '../lib/api/webhooks/stripe';
import * as accessLink from '../lib/api/access/link';
import * as accessVerify from '../lib/api/access/verify';
import * as unsubscribe from '../lib/api/esp/unsubscribe';
import * as metrics from '../lib/api/admin/metrics';
import * as adminOrders from '../lib/api/admin/orders';
import * as adminHealth from '../lib/api/admin/health';

type Handler = (ctx: Ctx) => Promise<Response> | Response;
type Module = { onRequestGet?: Handler; onRequestPost?: Handler; onRequestPut?: Handler };

/** Every /api route → its handler module. The frontend calls these paths (VITE_API_BASE_URL=/api). */
const ROUTES: Record<string, Module> = {
  '/api/leads': leads,
  '/api/events': events,
  '/api/lifecycle': lifecycle,
  '/api/entitlements': entitlements,
  '/api/assessment': assessment,
  '/api/files': files,
  '/api/payments/customer': customer,
  '/api/payments/intent': intent,
  '/api/payments/verify': verify,
  '/api/payments/save-method': saveMethod,
  '/api/payments/attach': attach,
  '/api/upsell/charge': upsell,
  '/api/webhooks/stripe': webhook,
  '/api/access/link': accessLink,
  '/api/access/verify': accessVerify,
  '/api/esp/unsubscribe': unsubscribe,
  '/api/admin/metrics': metrics,
  '/api/admin/orders': adminOrders,
  '/api/admin/health': adminHealth,
};

/** Server-to-server routes authenticate with a signature or bearer token instead of an Origin header. */
const SERVER_TO_SERVER = /^\/api\/(webhooks|esp)\//;

/**
 * Routes a request and applies the shared API policy:
 * - same-origin check on state-changing requests (CSRF defence alongside SameSite cookies)
 * - no-store + security headers on every response
 * Rate limiting: use Netlify's rate-limit rules / WAF on /api/leads, /api/payments/*, /api/upsell/*, /api/access/link.
 */
export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const mod = ROUTES[path];
  const method = request.method.toUpperCase();
  const handler = mod && (method === 'GET' || method === 'HEAD' ? mod.onRequestGet : method === 'POST' ? mod.onRequestPost : method === 'PUT' ? mod.onRequestPut : undefined);
  let res: Response;
  if (!mod) res = fail(404, 'Not found.', 'not_found');
  else if (!handler) res = fail(405, 'Method not allowed.', 'method_not_allowed');
  else if (method !== 'GET' && method !== 'HEAD' && !SERVER_TO_SERVER.test(path) && request.headers.get('Origin') !== (env.ALLOWED_ORIGIN || url.origin)) {
    res = fail(403, 'Request origin not allowed.', 'bad_origin');
  } else {
    try {
      res = await handler({ request, env, params: {} });
    } catch (e) {
      console.error('api error', path, e);
      res = fail(500, 'Something went wrong on our side. Try again in a moment.', 'server_error');
    }
  }
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  out.headers.set('X-Content-Type-Options', 'nosniff');
  if (!out.headers.has('Referrer-Policy')) out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return out;
}

export default async (request: Request, _context: Context) => route(request, netlifyEnv());

export const config: Config = { path: '/api/*' };
