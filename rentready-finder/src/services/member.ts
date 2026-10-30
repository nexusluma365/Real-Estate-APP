/**
 * RentReady platform API (same origin, main site's /api). Premium access is decided by the server from the
 * HttpOnly session cookie; nothing here unlocks anything on its own.
 */
const BASE = '/api';

export interface PremiumStatus { active: boolean; status?: string | null; current_period_end?: string | null; cancel_at_period_end?: boolean; grace_until?: string | null; had_premium?: boolean }
export type Classification = 'standard' | 'verified_second_chance' | 'unknown' | 'unavailable';
export type RRListing = (
  | { locked: true; listing_id: string; classification: 'verified_second_chance'; city: string; state: string; rent_cents: number | null; beds: number | null; baths: number | null; verified_at: string | null }
  | {
      locked: false; listing_id: string; classification: Classification; name: string; address: string | null; city: string; state: string; rent_cents: number | null;
      beds: number | null; baths: number | null; description: string | null; phone: string | null; website: string | null; photo_url: string | null;
      screening_note: string | null; source_name: string; source_url: string; verified_at: string | null;
    }
) & { /** A second-chance listing elsewhere in the state, shown because the searched city has none. */ nearby?: boolean };

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } });
  const data = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!r.ok) throw new ApiError(data.error || 'Something went wrong. Please try again.', r.status, data.code || 'error');
  return data as T;
}

export const getMembership = () => call<{ premium?: PremiumStatus; signed_in?: boolean; first_name?: string }>('/entitlements');

export interface ListingFilters { minRent: number | null; maxRent: number | null; bedrooms: number | null; secondChanceOnly: boolean }
export function getListings(place: string, f?: ListingFilters, signal?: AbortSignal) {
  const q = new URLSearchParams({ place });
  if (f?.minRent != null) q.set('min_rent', String(f.minRent));
  if (f?.maxRent != null) q.set('max_rent', String(f.maxRent));
  if (f?.bedrooms != null) q.set('beds', String(f.bedrooms));
  if (f?.secondChanceOnly) q.set('second_chance', '1');
  return call<{ place: { city: string; state: string }; premium: boolean; listings: RRListing[]; locked_count: number; filtered_out: number }>(`/listings?${q}`, { signal });
}

/** Approximate area from the visitor's IP (city/state), or null. Always shown as "approximate". */
export const getApproximateArea = () =>
  call<{ area: { city: string; state: string } | null }>('/geo').then((d) => (d.area ? `${d.area.city}, ${d.area.state}` : null)).catch(() => null);
export const openBillingPortal = async (returnTo: string) => {
  const r = await call<{ url: string }>('/premium/portal', { method: 'POST', body: JSON.stringify({ return_to: returnTo }) });
  window.location.assign(r.url);
};
export const signOut = () => call('/session/logout', { method: 'POST', body: '{}' }).catch(() => undefined);
export interface MemberSummary {
  first_name?: string;
  saved: { ref: string; label: string; detail: string | null }[];
  searches: { search_id: string; label: string; new_count: number }[];
  recent: { ref: string; label: string }[];
}
export const getMemberSummary = () => call<MemberSummary>('/member');
export const getListing = (id: string, signal?: AbortSignal) => call<{ premium: boolean; listing: RRListing }>(`/listings/detail?id=${encodeURIComponent(id)}`, { signal });
export const memberAction = (b: Record<string, unknown>) => call<{ ok: boolean; existing?: boolean }>('/member', { method: 'POST', body: JSON.stringify(b) });


/** Starts Stripe-hosted membership checkout and leaves the page. `returnTo` is where the member lands afterwards. */
export async function startMembershipCheckout(returnTo: string) {
  const r = await call<{ url: string }>('/premium/checkout', { method: 'POST', body: JSON.stringify({ return_to: returnTo }) });
  window.location.assign(r.url);
}

/** Ad attribution from the landing URL, kept for the session so every Finder event carries it. */
function attribution(): Record<string, string> {
  try {
    const q = new URLSearchParams(location.search);
    const fresh = Object.fromEntries(['utm_source', 'utm_campaign', 'gclid'].filter((k) => q.get(k)).map((k) => [k, q.get(k)!.slice(0, 100)]));
    if (Object.keys(fresh).length) sessionStorage.setItem('rr.finder.attr', JSON.stringify(fresh));
    const a = JSON.parse(sessionStorage.getItem('rr.finder.attr') || '{}') as Record<string, string>;
    // gclid without utm_source still means Google Ads.
    return { ...(a.utm_source ? { utm_source: a.utm_source } : a.gclid ? { utm_source: 'google_ads' } : {}), ...(a.utm_campaign ? { utm_campaign: a.utm_campaign } : {}) };
  } catch {
    return {};
  }
}
export const cameFromAd = () => /[?&](gclid|utm_source|utm_campaign)=/.test(location.search);

/** First-party analytics beacon (main site's /api/events). Never sends names, emails or addresses. */
export function track(event: string, props: { cta_location?: string; product?: string; value?: number } = {}) {
  try {
    const sid = sessionStorage.getItem('rr.finder.sid') || crypto.randomUUID();
    sessionStorage.setItem('rr.finder.sid', sid);
    const payload = JSON.stringify({ event, session_id: sid, page_path: location.pathname, landing_intent: 'finder', ...attribution(), ...props });
    if (!navigator.sendBeacon?.(`${BASE}/events`, new Blob([payload], { type: 'application/json' }))) void fetch(`${BASE}/events`, { method: 'POST', body: payload, keepalive: true });
  } catch {
    /* analytics must never break the page */
  }
}

export const money = (cents: number | null) => (cents == null ? null : `$${Math.round(cents / 100).toLocaleString('en-US')}`);
export const bedsLabel = (b: number | null) => (b == null ? null : b === 0 ? 'Studio' : `${b} bed${b === 1 ? '' : 's'}`);
export const bathsLabel = (b: number | null) => (b == null ? null : `${b} bath${b === 1 ? '' : 's'}`);

/** Fires an event at most once per browser session (e.g. "finder_opened", one locked card impression). */
export function trackOnce(key: string, event: string, props: Parameters<typeof track>[1] = {}) {
  try {
    if (sessionStorage.getItem(`rr.finder.once.${key}`)) return;
    sessionStorage.setItem(`rr.finder.once.${key}`, '1');
  } catch {
    /* fall through: track anyway */
  }
  track(event, props);
}

/** Guest-safe search memory: the last city searched (no personal data). */
export const lastSearch = {
  get: (): string | null => {
    try {
      return localStorage.getItem('rr.finder.lastPlace');
    } catch {
      return null;
    }
  },
  set: (q: string) => {
    try {
      localStorage.setItem('rr.finder.lastPlace', q.slice(0, 120));
    } catch {
      /* storage unavailable */
    }
  },
};

