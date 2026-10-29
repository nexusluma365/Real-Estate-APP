import type { Config } from '@netlify/functions';
import { sendListingAlerts } from '../lib/jobs/alerts';
import { netlifyEnv } from '../lib/platform';

/** Netlify Scheduled Function: daily new-listing alerts for Premium saved searches (see netlify/lib/jobs/alerts.ts). */
export default async () => {
  const env = netlifyEnv();
  if (!env.DB) {
    console.warn('listing-alerts: SUPABASE_DB_URL not set — skipped');
    return new Response('skipped', { status: 200 });
  }
  const r = await sendListingAlerts(env);
  console.log('listing-alerts', r);
  return new Response(JSON.stringify(r), { status: 200 });
};

export const config: Config = { schedule: '0 14 * * *' };
