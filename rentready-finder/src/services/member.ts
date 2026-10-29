/**
 * RentReady platform API (same origin, main site's /api). Premium access is decided by the server from the
 * HttpOnly session cookie; nothing here unlocks anything on its own.
 */
const BASE = '/api';

export interface PremiumStatus { active: boolean; status?: string | null; current_period_end?: string | null; cancel_at_period_end?: boolean; grace_until?: string | null; had_premium?: boolean }
export type Classification = 'standard' | 'verified_second_chance' | 'unknown' | 'unavailable';
export type RRListing =
  | { locked: true; listing_id: string; classification: 'verified_second_chance'; city: string; state: string; rent_cents: number | null; beds: number | null; baths: number | null; verified_at: string | null }
  | {
      locked: false; listing_id: string; classification: Classification; name: string; address: string | null; city: string; state: string; rent_cents: number | null;
      beds: number | null; baths: number | null; description: string | null; phone: string | null; website: string | null; photo_url: string | null;
      screening_note: string | null; source_name: string; source_url: string; verified_at: string | null;
    };

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
export const getListings = (place: string, signal?: AbortSignal) =>
  call<{ place: { city: string; state: string }; premium: boolean; listings: RRListing[]; locked_count: number }>(`/listings?place=${encodeURIComponent(place)}`, { signal });
export const getListing = (id: string, signal?: AbortSignal) => call<{ premium: boolean; listing: RRListing }>(`/listings/detail?id=${encodeURIComponent(id)}`, { signal });
export const memberAction = (b: Record<string, unknown>) => call<{ ok: boolean; existing?: boolean }>('/member', { method: 'POST', body: JSON.stringify(b) });
export const getSavedRefs = () => call<{ saved: { ref: string }[] }>('/member').then((d) => d.saved.map((s) => s.ref));

/** Starts Stripe-hosted membership checkout and leaves the page. `returnTo` is where the member lands afterwards. */
export async function startMembershipCheckout(returnTo: string) {
  const r = await call<{ url: string }>('/premium/checkout', { method: 'POST', body: JSON.stringify({ return_to: returnTo }) });
  window.location.assign(r.url);
}

/** First-party analytics beacon (main site's /api/events). Never sends names, emails or addresses. */
export function track(event: string, props: { cta_location?: string; product?: string; value?: number } = {}) {
  try {
    const sid = sessionStorage.getItem('rr.finder.sid') || crypto.randomUUID();
    sessionStorage.setItem('rr.finder.sid', sid);
    const payload = JSON.stringify({ event, session_id: sid, page_path: location.pathname, ...props });
    if (!navigator.sendBeacon?.(`${BASE}/events`, new Blob([payload], { type: 'application/json' }))) void fetch(`${BASE}/events`, { method: 'POST', body: payload, keepalive: true });
  } catch {
    /* analytics must never break the page */
  }
}

export const money = (cents: number | null) => (cents == null ? null : `$${Math.round(cents / 100).toLocaleString('en-US')}`);
export const bedsLabel = (b: number | null) => (b == null ? null : b === 0 ? 'Studio' : `${b} bed${b === 1 ? '' : 's'}`);
export const bathsLabel = (b: number | null) => (b == null ? null : `${b} bath${b === 1 ? '' : 's'}`);
