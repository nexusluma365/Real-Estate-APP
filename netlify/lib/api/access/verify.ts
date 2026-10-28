import { notConfigured, setSession, type Ctx } from '../../_lib';

const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** GET /api/access/verify?token=… — consumes a single-use sign-in token, sets the session cookie, redirects to /access. */
export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.SESSION_SECRET || !env.DB) return notConfigured('Sign-in links');
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const back = (q: string) => Response.redirect(`${url.origin}/access${q}`, 302);
  if (!/^[a-f0-9]{64}$/.test(token)) return back('?link=invalid');
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT t.lead_id, t.expires_at, t.used_at, l.stripe_customer_id FROM rr_access_tokens t JOIN rr_leads l ON l.lead_id = t.lead_id WHERE t.token_hash = ?')
    .bind(hash).first<{ lead_id: string; expires_at: string; used_at: string | null; stripe_customer_id: string | null }>();
  if (!row || row.used_at || row.expires_at < new Date().toISOString() || !row.stripe_customer_id) return back('?link=expired');
  await env.DB.prepare('UPDATE rr_access_tokens SET used_at = ? WHERE token_hash = ?').bind(new Date().toISOString(), hash).run();
  const cookie = await setSession(env, { lead_id: row.lead_id, customer_id: row.stripe_customer_id });
  return new Response(null, { status: 302, headers: { Location: `${url.origin}/access`, 'Set-Cookie': cookie, 'Cache-Control': 'no-store' } });
};
