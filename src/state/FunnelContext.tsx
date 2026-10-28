import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchEntitlements } from '../lib/entitlementService';
import { getLead } from '../lib/leadService';
import { setAnalyticsCustomer } from '../lib/analytics';
import type { Entitlements, Lead, ProductId } from '../lib/types';

interface FunnelCtx {
  lead: Lead | null;
  setLead: (l: Lead) => void;
  entitlements: Entitlements;
  refreshEntitlements: () => Promise<Entitlements>;
  owns: (p: ProductId) => boolean;
  firstName: string;
}

const Ctx = createContext<FunnelCtx | null>(null);

export function FunnelProvider({ children }: { children: ReactNode }) {
  const [lead, setLeadState] = useState<Lead | null>(() => getLead());
  const [entitlements, setEnt] = useState<Entitlements>({ status: 'loading', products: [], source: 'none' });

  const refreshEntitlements = useCallback(async () => {
    const e = await fetchEntitlements();
    setEnt(e);
    setAnalyticsCustomer(e.customer_id);
    return e;
  }, []);

  useEffect(() => {
    void refreshEntitlements();
  }, [refreshEntitlements]);

  const value = useMemo<FunnelCtx>(
    () => ({
      lead,
      setLead: setLeadState,
      entitlements,
      refreshEntitlements,
      owns: (p) => entitlements.products.includes(p),
      firstName: entitlements.first_name || lead?.first_name || '',
    }),
    [lead, entitlements, refreshEntitlements],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFunnel() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useFunnel must be used within FunnelProvider');
  return c;
}
