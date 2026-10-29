import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { Alert, Loader, Spinner } from '../components/ui';
import { PRODUCTS } from '../config/products';
import { ApiError } from '../lib/api';
import { isMock } from '../lib/env';
import { fetchMember, finderHref, memberAction, openBillingPortal, PREMIUM_INTRO, PREMIUM_PRICE, startPremium, type MemberData } from '../lib/memberService';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

/** /account — member dashboard: membership & billing, saved apartments and searches, recently viewed, purchases. */
export default function Account() {
  const [data, setData] = useState<MemberData | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'signin' | 'error'>('loading');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = () =>
    fetchMember()
      .then((d) => {
        setData(d);
        setState('ok');
      })
      .catch((e) => setState(e instanceof ApiError && e.status === 401 ? 'signin' : 'error'));
  useEffect(() => {
    if (isMock) setState('signin');
    else void load();
  }, []);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Please try again.');
    } finally {
      setBusy('');
    }
  }

  if (state === 'loading') return <Loader label="Loading your account" />;
  if (state !== 'ok' || !data) {
    return (
      <Layout chrome="customer">
        <Seo title="My account | RentReady" noindex />
        <section className="band"><div className="wrap" style={{ maxWidth: 620 }}>
          <h1 style={{ fontSize: 'var(--step-4)' }}>My account</h1>
          {state === 'error' ? <div style={{ marginTop: 16 }}><Alert kind="error">Your account didn’t load. Please try again in a moment.</Alert></div> : (
            <p className="lede" style={{ marginTop: 12 }}>Sign in with the email you used at RentReady — we’ll email you a secure link.</p>
          )}
          <Link className="btn" style={{ marginTop: 24 }} to="/access">Email me a sign-in link</Link>
        </div></section>
      </Layout>
    );
  }

  const p = data.premium;
  const owns = (id: string) => data.products.includes(id);
  return (
    <Layout chrome="customer">
      <Seo title="My account | RentReady" noindex />
      <section className="access-head"><div className="wrap">
        <h1 style={{ fontSize: 'var(--step-5)' }}>Welcome{data.first_name ? `, ${data.first_name}` : ''}.</h1>
        <p className="lede" style={{ marginTop: 12, color: '#e3dccf' }}>{data.email}</p>
      </div></section>
      <section className="band" style={{ paddingTop: 36 }}>
        <div className="wrap stack acct" style={{ ['--s' as string]: '24px', maxWidth: 860 }}>
          {error && <Alert kind="error">{error}</Alert>}

          <section className="panel" aria-labelledby="mem-h">
            <h2 id="mem-h">RentReady Premium</h2>
            {p.active ? (
              <>
                <p className="acct-status"><span className="acct-dot" /> {p.status === 'past_due' ? 'Payment due' : 'Active'}</p>
                <p className="muted">
                  {p.status === 'past_due'
                    ? `Your last renewal didn’t go through. Update your card to keep access${p.grace_until ? ` — access continues until ${day(p.grace_until)}` : ''}.`
                    : p.cancel_at_period_end
                      ? `Canceled — you keep access until ${day(p.current_period_end)} and won’t be charged again.`
                      : `Renews at ${PREMIUM_PRICE} on ${day(p.current_period_end)}. Cancel any time.`}
                </p>
                <div className="acct-actions">
                  <button className="btn btn-sm" disabled={!!busy} onClick={() => act('portal', () => openBillingPortal('/account'))}>
                    {busy === 'portal' ? <><Spinner /> Opening…</> : p.status === 'past_due' ? 'Update payment method' : 'Manage membership & billing'}
                  </button>
                  <a className="bk-link" href="/finder/">Search apartments</a>
                </div>
                <p className="fine">Billing is handled by Stripe: update your card, download invoices or cancel there.</p>
              </>
            ) : (
              <>
                <p className="muted">
                  {p.had_premium ? 'Your membership has ended. Your saved apartments and searches are still here.' : `Unlock verified second-chance listings, saved searches and new-listing alerts — ${PREMIUM_INTRO} for your first month, then ${PREMIUM_PRICE}/month.`}
                </p>
                <div className="acct-actions">
                  <button className="btn btn-sm" disabled={!!busy} onClick={() => act('join', () => startPremium('/account'))}>
                    {busy === 'join' ? <><Spinner /> Opening checkout…</> : p.had_premium ? `Rejoin for ${PREMIUM_PRICE}/month` : `Start for ${PREMIUM_INTRO}`}
                  </button>
                  <Link className="bk-link" to="/premium">What’s included</Link>
                </div>
              </>
            )}
          </section>

          <section className="panel" aria-labelledby="saved-h">
            <h2 id="saved-h">Saved apartments</h2>
            {data.saved.length ? (
              <ul className="acct-list">
                {data.saved.map((s) => (
                  <li key={s.ref}>
                    <a href={finderHref(s.ref)}><strong>{s.label}</strong>{s.detail && <span>{s.detail}</span>}</a>
                    <button className="acct-x" aria-label={`Remove ${s.label}`} disabled={!!busy} onClick={() => act(s.ref, () => memberAction({ action: 'unsave', ref: s.ref }))}>Remove</button>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Tap the heart on any apartment in <a href="/finder/">RentReady Finder</a> to keep it here.</p>}
          </section>

          <section className="panel" aria-labelledby="search-h">
            <h2 id="search-h">Saved searches & alerts</h2>
            {data.searches.length ? (
              <ul className="acct-list">
                {data.searches.map((q) => (
                  <li key={q.search_id}>
                    <a href={`/finder/?q=${encodeURIComponent(q.label)}`}><strong>{q.label}</strong><span>{q.new_count ? `${q.new_count} new since you saved it` : 'No new listings yet'}</span></a>
                    <label className="acct-toggle">
                      <input type="checkbox" checked={q.alerts} disabled={!!busy} onChange={(e) => act(q.search_id, () => memberAction({ action: 'search_alerts', search_id: q.search_id, alerts: e.target.checked }))} />
                      Email alerts
                    </label>
                    <button className="acct-x" aria-label={`Delete saved search ${q.label}`} disabled={!!busy} onClick={() => act(q.search_id, () => memberAction({ action: 'delete_search', search_id: q.search_id }))}>Delete</button>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Search a city in <a href="/finder/">RentReady Finder</a> and choose “Save search & get alerts”.</p>}
          </section>

          {data.recent.length > 0 && (
            <section className="panel" aria-labelledby="recent-h">
              <h2 id="recent-h">Recently viewed</h2>
              <ul className="acct-list">
                {data.recent.map((r) => <li key={r.ref}><a href={finderHref(r.ref)}><strong>{r.label}</strong>{r.detail && <span>{r.detail}</span>}</a></li>)}
              </ul>
            </section>
          )}

          <section className="panel" aria-labelledby="prep-h">
            <h2 id="prep-h">Prepare before you apply</h2>
            <ul className="acct-list">
              <li><Link to="/checklist"><strong>Before-You-Apply Checklist</strong><span>Documents, questions to ask and what to check first</span></Link></li>
              {owns('creditready') && <li><Link to="/gameplan"><strong>Your game plan</strong><span>From your assessment</span></Link></li>}
              {(owns('creditready') || owns('guide')) && <li><Link to="/access"><strong>My purchases & downloads</strong><span>{[owns('guide') && !owns('creditready') && PRODUCTS.guide.name, owns('creditready') && PRODUCTS.creditready.name, owns('playbook') && PRODUCTS.playbook.name].filter(Boolean).join(' · ')}</span></Link></li>}
              {!owns('creditready') && !owns('guide') && <li><Link to="/"><strong>Before They Say No™</strong><span>What property managers may review, and how to prepare</span></Link></li>}
            </ul>
          </section>
        </div>
      </section>
    </Layout>
  );
}
