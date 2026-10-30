import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, getMemberSummary, getMembership, memberAction, signOut as apiSignOut, track, type MemberSummary, type PremiumStatus } from '../services/member';

/** guest · signed_in (no membership history) · active · past_due (payment failed) · lapsed (canceled / expired). */
export type MemberState = 'guest' | 'signed_in' | 'active' | 'past_due' | 'lapsed';

export function memberState(signedIn: boolean, p: PremiumStatus): MemberState {
  if (p.active) return p.status === 'past_due' ? 'past_due' : 'active';
  if (p.status === 'past_due' || p.status === 'unpaid') return 'past_due';
  if (p.had_premium) return 'lapsed';
  return signedIn ? 'signed_in' : 'guest';
}

interface MemberCtx {
  premium: PremiumStatus;
  state: MemberState;
  signedIn: boolean;
  loading: boolean;
  /** Saved apartments, saved searches (with new-listing counts) and recent views — signed-in members only. */
  summary: MemberSummary | null;
  refresh: () => Promise<void>;
  /** The RentReady Premium offer. `returnTo` is where checkout (or sign-in) brings the visitor back to. */
  offer: { open: boolean; reason: string; returnTo: string };
  openOffer: (reason: string, location: string, returnTo?: string) => void;
  closeOffer: () => void;
  saved: Set<string>;
  toggleSave: (ref: string, label: string, detail?: string) => Promise<void>;
  recordView: (ref: string, label: string, detail?: string) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<MemberCtx | null>(null);
const here = () => `${location.pathname}${location.search}`;

export function MemberProvider({ children }: { children: ReactNode }) {
  const [premium, setPremium] = useState<PremiumStatus>({ active: false });
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<MemberSummary | null>(null);
  const [offer, setOffer] = useState({ open: false, reason: '', returnTo: '' });
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const m = await getMembership();
      const p = m.premium || { active: false };
      setPremium(p);
      setSignedIn(!!m.signed_in);
      const s = m.signed_in ? await getMemberSummary().catch(() => null) : null;
      setSummary(s);
      setSaved(new Set(s?.saved.map((x) => x.ref) || []));
    } catch {
      setPremium({ active: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openOffer = useCallback((reason: string, location: string, returnTo?: string) => {
    setOffer({ open: true, reason, returnTo: returnTo || here() });
    track('membership_offer_view', { cta_location: location, product: 'premium' });
  }, []);
  const closeOffer = useCallback(() => setOffer((o) => ({ ...o, open: false })), []);

  const toggleSave = useCallback(async (ref: string, label: string, detail?: string) => {
    if (!premium.active) {
      openOffer('Save apartments to your account and come back to them any time.', 'save_listing');
      return;
    }
    const on = !saved.has(ref);
    const flip = (add: boolean) => setSaved((s) => {
      const n = new Set(s);
      if (add) n.add(ref);
      else n.delete(ref);
      return n;
    });
    flip(on);
    try {
      await memberAction({ action: on ? 'save' : 'unsave', ref, label, detail });
      if (on) track('listing_saved', { cta_location: ref.split(':')[0] });
    } catch (e) {
      flip(!on);
      if (e instanceof ApiError && e.code === 'premium_required') openOffer('Save apartments to your account and come back to them any time.', 'save_listing');
    }
  }, [premium.active, saved, openOffer]);

  const recordView = useCallback((ref: string, label: string, detail?: string) => {
    if (premium.active) void memberAction({ action: 'viewed', ref, label, detail }).catch(() => undefined);
  }, [premium.active]);

  const signOut = useCallback(async () => {
    await apiSignOut();
    try {
      localStorage.removeItem('rr.lead');
    } catch {
      /* storage unavailable */
    }
    setSummary(null);
    setSaved(new Set());
    await refresh();
  }, [refresh]);

  const state = memberState(signedIn, premium);
  const value = useMemo(
    () => ({ premium, state, signedIn, loading, summary, refresh, offer, openOffer, closeOffer, saved, toggleSave, recordView, signOut }),
    [premium, state, signedIn, loading, summary, refresh, offer, openOffer, closeOffer, saved, toggleSave, recordView, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMember() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMember must be used inside MemberProvider');
  return v;
}
