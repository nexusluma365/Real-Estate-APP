import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, getMembership, getSavedRefs, memberAction, track, type PremiumStatus } from '../services/member';

interface MemberState {
  premium: PremiumStatus;
  loading: boolean;
  refresh: () => Promise<void>;
  /** Opens the RentReady Premium offer. `reason` is shown at the top and tracked. */
  offer: { open: boolean; reason: string };
  openOffer: (reason: string, location: string) => void;
  closeOffer: () => void;
  saved: Set<string>;
  toggleSave: (ref: string, label: string, detail?: string) => Promise<void>;
  recordView: (ref: string, label: string, detail?: string) => void;
}

const Ctx = createContext<MemberState | null>(null);

export function MemberProvider({ children }: { children: ReactNode }) {
  const [premium, setPremium] = useState<PremiumStatus>({ active: false });
  const [loading, setLoading] = useState(true);
  const [offer, setOffer] = useState({ open: false, reason: '' });
  const [saved, setSaved] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const m = await getMembership();
      const p = m.premium || { active: false };
      setPremium(p);
      if (p.active) setSaved(new Set(await getSavedRefs().catch(() => [])));
    } catch {
      setPremium({ active: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openOffer = useCallback((reason: string, location: string) => {
    setOffer({ open: true, reason });
    track('membership_offer_view', { cta_location: location, product: 'premium' });
  }, []);
  const closeOffer = useCallback(() => setOffer((o) => ({ ...o, open: false })), []);

  const toggleSave = useCallback(async (ref: string, label: string, detail?: string) => {
    if (!premium.active) {
      openOffer('Save apartments to your account and come back to them any time.', 'save_listing');
      return;
    }
    const on = !saved.has(ref);
    setSaved((s) => {
      const n = new Set(s);
      if (on) n.add(ref);
      else n.delete(ref);
      return n;
    });
    try {
      await memberAction({ action: on ? 'save' : 'unsave', ref, label, detail });
      if (on) track('listing_saved', { cta_location: ref.split(':')[0] });
    } catch (e) {
      setSaved((s) => {
        const n = new Set(s);
        if (on) n.delete(ref);
        else n.add(ref);
        return n;
      });
      if (e instanceof ApiError && e.code === 'premium_required') openOffer('Save apartments to your account and come back to them any time.', 'save_listing');
    }
  }, [premium.active, saved, openOffer]);

  const recordView = useCallback((ref: string, label: string, detail?: string) => {
    if (premium.active) void memberAction({ action: 'viewed', ref, label, detail }).catch(() => undefined);
  }, [premium.active]);

  const value = useMemo(() => ({ premium, loading, refresh, offer, openOffer, closeOffer, saved, toggleSave, recordView }), [premium, loading, refresh, offer, openOffer, closeOffer, saved, toggleSave, recordView]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMember() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMember must be used inside MemberProvider');
  return v;
}
