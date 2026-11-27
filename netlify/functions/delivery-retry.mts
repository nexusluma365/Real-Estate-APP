import type { Config } from '@netlify/functions';
import { retryDeliveries } from '../lib/delivery';
import { netlifyEnv } from '../lib/platform';

/** Netlify Scheduled Function: retries failed package emails and catches paid orders whose delivery never started (see netlify/lib/delivery.ts). */
export default async () => {
  const env = netlifyEnv();
  if (!env.DB) {
    console.warn('delivery-retry: SUPABASE_DB_URL not set — skipped');
    return new Response('skipped', { status: 200 });
  }
  const r = await retryDeliveries(env);
  console.log('delivery-retry', r);
  return new Response(JSON.stringify(r), { status: 200 });
};

export const config: Config = { schedule: '*/10 * * * *' };
