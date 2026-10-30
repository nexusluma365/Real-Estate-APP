import type { Config } from '@netlify/functions';
import { processQueue } from '../lib/scan';
import { netlifyEnv } from '../lib/platform';

/** Netlify Scheduled Function: checks a few queued property websites per minute (see netlify/lib/scan.ts). */
export default async () => {
  const env = netlifyEnv();
  if (!env.DB) return new Response('skipped', { status: 200 });
  const r = await processQueue(env, (env.ALLOWED_ORIGIN || 'https://werentreadygo.com').replace(/\/+$/, ''));
  if ('processed' in r && r.processed) console.log('scan-queue', r);
  return new Response(JSON.stringify(r), { status: 200 });
};

export const config: Config = { schedule: '* * * * *' };
