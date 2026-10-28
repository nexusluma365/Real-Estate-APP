import type { Attribution } from './types';
import { read, write } from './storage';

const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid'] as const;
const clean = (v: string | null) => (v ? v.replace(/[^\w\-.~+ %:/]/g, '').slice(0, 200) : undefined);

/**
 * Captures UTM/gclid on every landing. First-touch values are kept,
 * latest values overwrite when present (so a returning ad click updates gclid).
 */
export function captureAttribution(search: string, path: string, intent?: string): Attribution {
  const params = new URLSearchParams(search);
  const existing = read<Attribution>('attribution', {});
  const incoming: Attribution = {};
  for (const k of KEYS) {
    const v = clean(params.get(k));
    if (v) incoming[k] = v;
  }
  const intentParam = clean(params.get('intent'));
  const next: Attribution = {
    ...existing,
    ...incoming,
    landing_intent: intent || intentParam || existing.landing_intent || 'general',
    landing_path: existing.landing_path || path,
    referrer: existing.referrer || (typeof document !== 'undefined' ? document.referrer.slice(0, 200) : undefined),
    captured_at: existing.captured_at || new Date().toISOString(),
  };
  // A specific intent landing always wins over 'general'
  if (intent) next.landing_intent = intent;
  write('attribution', next);
  return next;
}

export function getAttribution(): Attribution {
  return read<Attribution>('attribution', { landing_intent: 'general' });
}
