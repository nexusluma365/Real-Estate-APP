import { type Ctx } from '../../_lib';
import { activateFromCheckout, safeReturn } from '../../premium';

/**
 * GET /api/premium/return?session_id=…&to=/finder/… — Stripe Checkout's success_url. Confirms the payment with Stripe
 * (server-side), activates the membership, signs the member in and sends them back to the search they came from.
 */
export const onRequestGet = async ({ request, env }: Ctx) => {
  const url = new URL(request.url);
  const to = safeReturn(url.searchParams.get('to'));
  const dest = (state: string) => `${url.origin}${to}${to.includes('?') ? '&' : '?'}premium=${state}`;
  const id = url.searchParams.get('session_id') || '';
  if (!env.STRIPE_SECRET_KEY || !env.SESSION_SECRET || !env.DB || !/^cs_[\w]+$/.test(id)) return Response.redirect(dest('pending'), 302);
  const done = await activateFromCheckout(env, id).catch((e) => {
    console.error('premium return', e);
    return null;
  });
  if (!done) return Response.redirect(dest('pending'), 302);
  return new Response(null, { status: 302, headers: { Location: dest(done.active ? 'active' : 'pending'), 'Set-Cookie': done.cookie, 'Cache-Control': 'no-store' } });
};
