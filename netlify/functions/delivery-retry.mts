import type { Config } from '@netlify/functions';
import { retryDeliveries } from '../lib/delivery';
import { netlifyEnv } from '../lib/platform';
import { isMissingSchema } from '../lib/_lib';

/** Netlify Scheduled Function: retries failed package emails and catches paid orders whose delivery never started (see netlify/lib/delivery.ts). */
export default async () => {
  const env = netlifyEnv();
  if (!env.DB) {
    console.warn('delivery-retry: SUPABASE_DB_URL not set — skipped');
    return new Response('skipped', { status: 200 });
  }
  try {
    const r = await retryDeliveries(env);
    console.log('delivery-retry', r);
    return new Response(JSON.stringify(r), { status: 200 });
  } catch (e) {
    if (isMissingSchema(e)) {
      console.warn('delivery-retry: rr_deliveries missing — run POST /api/admin/migrate');
      return new Response('migration pending', { status: 200 });
    }
    throw e;
  }
};

export const config: Config = { schedule: '*/10 * * * *' };
