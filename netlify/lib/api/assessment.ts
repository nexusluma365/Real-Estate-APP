import { body, fail, getSession, json, notConfigured, type Ctx } from '../_lib';

/** PUT /api/assessment — persist assessment answers to the customer record (never to analytics). */
export const onRequestPut = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.SESSION_SECRET) return notConfigured('Assessment storage');
  const s = await getSession(request, env);
  if (!s?.customer_id) return fail(401, 'Sign in required.');
  const b = await body<unknown>(request);
  await env.DB.prepare('INSERT INTO rr_assessments (customer_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(customer_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(s.customer_id, JSON.stringify(b).slice(0, 10000), new Date().toISOString()).run();
  return json({ ok: true });
};
