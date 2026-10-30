import { json, type Ctx } from '../../_lib';

/** POST /api/session/logout — signs this browser out (expires the HttpOnly session cookie). Nothing else changes. */
export const onRequestPost = async (_ctx: Ctx) =>
  json({ ok: true }, 200, { 'Set-Cookie': 'rr_sid=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
