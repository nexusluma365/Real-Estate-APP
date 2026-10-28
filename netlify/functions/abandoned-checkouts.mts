import type { Config } from '@netlify/functions';
import { detectAbandonedCheckouts } from '../lib/jobs/abandoned';
import { netlifyEnv } from '../lib/platform';

/** Netlify Scheduled Function: flags abandoned checkouts every 15 minutes (see netlify/lib/jobs/abandoned.ts). */
export default async () => {
  const env = netlifyEnv();
  if (!env.DB) {
    console.warn('abandoned-checkouts: TURSO_DATABASE_URL not set — skipped');
    return new Response('skipped', { status: 200 });
  }
  const r = await detectAbandonedCheckouts(env);
  console.log('abandoned-checkouts', r);
  return new Response(JSON.stringify(r), { status: 200 });
};

export const config: Config = { schedule: '*/15 * * * *' };
