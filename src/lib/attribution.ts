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

/** Link parameters that carry an affiliate id. `hop` is the one ClickBank adds to hoplinks. */
const AFFILIATE_PARAMS = ['hop', 'aff', 'ref', 'affiliate'] as const;
/** How long an affiliate referral stays attached to this browser (matches a typical 60-day affiliate cookie). */
const AFFILIATE_DAYS = 60;

/**
 * Records an affiliate id from the current URL on ANY page (affiliates may link to the home page, the Bundle page or
 * checkout). The latest referral wins, so the affiliate who sent the visitor most recently is credited.
 */
export function captureAffiliate(search: string): void {
  const params = new URLSearchParams(search);
  const raw = AFFILIATE_PARAMS.map((k) => params.get(k)).find((v) => v && /^[A-Za-z0-9_.-]{1,40}$/.test(v.trim()));
  if (!raw) return;
  write('attribution', { ...read<Attribution>('attribution', {}), affiliate: raw.trim().toLowerCase(), affiliate_at: new Date().toISOString() });
}

/** The affiliate to credit for a purchase now, if the referral hasn't expired. */
export function currentAffiliate(): string | undefined {
  const a = getAttribution();
  if (!a.affiliate || !a.affiliate_at) return undefined;
  return Date.now() - Date.parse(a.affiliate_at) <= AFFILIATE_DAYS * 86400000 ? a.affiliate : undefined;
}
