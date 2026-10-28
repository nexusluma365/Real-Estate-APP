import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useFunnel } from '../state/FunnelContext';
import type { ProductId } from '../lib/types';
import { Loader } from './ui';
import { Icon } from './Icon';
import { Layout } from './Layout';
import { Seo } from './Seo';

/** Checkout needs a known lead (name + email from /start). */
export function RequireLead({ children }: { children: ReactNode }) {
  const { lead } = useFunnel();
  const loc = useLocation();
  if (!lead) return <Navigate to={`/start?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/**
 * Paid routes. Access comes ONLY from server-confirmed entitlements
 * (or mock-mode simulated purchases). Typing the URL never unlocks anything.
 */
export function RequireProduct({ product, children }: { product: ProductId | ProductId[]; children: ReactNode }) {
  const { entitlements, owns } = useFunnel();
  if (entitlements.status === 'loading') return <Loader label="Checking your access" />;
  if (entitlements.status === 'error') {
    return (
      <Layout>
        <Seo title="Access check failed | RentReady" noindex />
        <div className="state-page">
          <div className="state-card stack">
            <h1 style={{ fontSize: 'var(--step-4)' }}>We couldn’t confirm your access.</h1>
            <p className="muted">Check your connection and reload. If you purchased, your access is safe.</p>
            <div className="cta-row" style={{ justifyContent: 'center' }}>
              <button className="btn" onClick={() => location.reload()}>Reload page</button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }
  if (!(Array.isArray(product) ? product : [product]).some(owns)) return <LockedPage />;
  return <>{children}</>;
}

function LockedPage() {
  return (
    <Layout>
      <Seo title="Customer access | RentReady" noindex />
      <div className="state-page">
        <div className="state-card stack" style={{ ['--s' as string]: '18px' }}>
          <div className="seal" style={{ color: 'var(--brass-deep)', borderColor: 'var(--brass)' }}>
            <Icon name="lock" />
          </div>
          <h1 style={{ fontSize: 'var(--step-4)' }}>This page is for RentReady customers.</h1>
          <p className="muted">
            If you’ve purchased, open the access link we emailed you on this device. If you haven’t yet, see your options — the book or the RentReady Digital Bundle.
          </p>
          <div className="cta-row" style={{ justifyContent: 'center' }}>
            <Link className="btn" to="/#options">See the options</Link>
            <Link className="btn btn-outline" to="/access">I already purchased</Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
