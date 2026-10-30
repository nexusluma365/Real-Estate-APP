import { bearerOk, fail, json, notConfigured, type Ctx } from '../../_lib';
import { MIGRATIONS } from '../../migrations';

/**
 * POST /api/admin/migrate (Authorization: Bearer ADMIN_TOKEN) — applies RentReady's own idempotent migrations
 * (rr_ tables only: CREATE … IF NOT EXISTS, RLS, REVOKE). The Supabase project is shared with another app, so this
 * never touches migration history or anything outside rr_. Safe to run more than once.
 */
const ALLOWED = /^(CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS rr_|ALTER TABLE rr_\w+ (ENABLE ROW LEVEL SECURITY|ADD COLUMN IF NOT EXISTS)|REVOKE ALL ON TABLE rr_)/i;

export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.ADMIN_TOKEN) return notConfigured('Migrations');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const applied: string[] = [];
  for (const [name, sql] of MIGRATIONS) {
    const stmts = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const bad = stmts.find((s) => !ALLOWED.test(s));
    if (bad) return fail(500, `Refusing to run a statement outside rr_: ${bad.slice(0, 80)}`, 'unsafe_migration');
    for (const s of stmts) await env.DB.prepare(s).bind().run();
    applied.push(`${name} (${stmts.length} statements)`);
  }
  return json({ ok: true, applied });
};
