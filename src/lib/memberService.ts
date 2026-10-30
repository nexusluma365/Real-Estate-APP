import { api } from './api';
import { write } from './storage';

/** RentReady Premium + account (server decides everything from the HttpOnly session; see netlify/lib/api/member.ts). */
export interface PremiumStatus { active: boolean; status: string | null; current_period_end: string | null; cancel_at_period_end: boolean; grace_until: string | null; had_premium: boolean }
export interface MemberData {
  email?: string;
  first_name?: string;
  premium: PremiumStatus;
  products: string[];
  saved: { ref: string; label: string; detail: string | null; saved_at: string }[];
  searches: { search_id: string; label: string; alerts: boolean; new_count: number; created_at: string }[];
  recent: { ref: string; label: string; detail: string | null; viewed_at: string }[];
}

export const PREMIUM_PRICE = '$19.99';
export const PREMIUM_INTRO = '$5';

export const fetchMember = () => api<MemberData>('/member');
export const memberAction = (b: Record<string, unknown>) => api<{ ok: boolean }>('/member', { json: b });

/** Stripe-hosted subscription checkout; returns to `returnTo` on this site afterwards. */
export async function startPremium(returnTo: string) {
  const r = await api<{ url: string }>('/premium/checkout', { json: { return_to: returnTo } });
  window.location.assign(r.url);
}

/** Stripe customer portal: update card, invoices, cancel. */
export async function openBillingPortal(returnTo = '/account') {
  const r = await api<{ url: string }>('/premium/portal', { json: { return_to: returnTo } });
  window.location.assign(r.url);
}

/** Where a saved/viewed apartment lives in RentReady Finder. */
export const finderHref = (ref: string) => {
  const [kind, id] = ref.split(':');
  return kind === 'listing' ? `/finder/listing/${encodeURIComponent(id)}` : `/finder/property/${encodeURIComponent(id)}`;
};

/** Signs this browser out: expires the session cookie and forgets the saved lead details on this device. */
export async function signOut() {
  await api('/session/logout', { json: {} }).catch(() => undefined);
  write('lead', null);
}

/** Emails a one-time sign-in link (purchases or Premium). `next` is where the link lands. Same reply for any email. */
export const requestSignInLink = (email: string, next: string) => api('/access/link', { json: { email, next } });

/** Membership state for navigation and notices. */
export type MemberState = 'guest' | 'signed_in' | 'active' | 'past_due' | 'lapsed';
export function memberState(e: { signed_in?: boolean; premium?: { active: boolean; status?: string | null; had_premium?: boolean } }): MemberState {
  const p = e.premium;
  if (p?.active) return p.status === 'past_due' ? 'past_due' : 'active';
  if (p?.status === 'past_due' || p?.status === 'unpaid') return 'past_due';
  if (p?.had_premium) return 'lapsed';
  return e.signed_in ? 'signed_in' : 'guest';
}

