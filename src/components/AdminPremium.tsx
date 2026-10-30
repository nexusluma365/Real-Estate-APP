import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { env } from '../lib/env';

/** /admin panels for RentReady Premium (membership numbers) and RentReady listings (add / verify). Bearer-token API only. */
interface PM {
  members: { with_access: number; intro_month: number; past_due: number; canceling: number; started: number; ended: number; mrr_cents: number };
  billing: { revenue_cents: number; refunded_cents: number; renewals_paid: number; renewals_failed: number; renewal_success_rate: number | null };
  funnel: {
    finder_opened: number; location_set: number; finder_searches: number; locked_listing_views: number; unlock_clicks: number; offer_views: number;
    checkout_starts: number; joins: number; premium_listings_unlocked: number; reached_first_renewal: number;
  };
  listings: { by_classification: { k: string; n: number }[]; needs_reverification: number; coverage: { k: string; n: number; verified: number }[] };
  saved_searches: { total: number; with_alerts: number; members: number };
}
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

export function PremiumPanel({ token, days, spendCents = 0 }: { token: string; days: number; spendCents?: number }) {
  const [d, setD] = useState<PM | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`${env.apiBase}/admin/premium-metrics?days=${days}`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' })
      .then(async (r) => (r.ok ? setD(await r.json()) : setErr(`Error ${r.status}`)))
      .catch(() => setErr('Couldn’t load membership numbers.'));
  }, [token, days]);
  if (err) return <section className="panel"><h2>RentReady Premium</h2><p className="muted">{err}</p></section>;
  if (!d) return null;
  const t = (label: string, value: string, sub?: string) => (
    <div className="adm-tile" key={label}><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>
  );
  return (
    <section className="panel">
      <h2>RentReady Premium</h2>
      <div className="adm-tiles">
        {t('Members with access', String(d.members.with_access), `${d.members.intro_month} in their $5 month`)}
        {t('MRR (at $19.99)', money(d.members.mrr_cents), `${d.members.canceling} canceling at period end`)}
        {t('Payment past due', String(d.members.past_due), 'in the 7-day grace period or ending')}
        {t(`Joined / ended (${days}d)`, `${d.members.started} / ${d.members.ended}`)}
        {t(`Membership revenue (${days}d)`, money(d.billing.revenue_cents), d.billing.refunded_cents ? `${money(d.billing.refunded_cents)} refunded` : undefined)}
        {t('Renewal success', d.billing.renewal_success_rate == null ? '—' : `${Math.round(d.billing.renewal_success_rate * 100)}%`, `${d.billing.renewals_paid} paid · ${d.billing.renewals_failed} failed`)}
        {t('Cost per Premium signup', spendCents && d.members.started ? money(Math.round(spendCents / d.members.started)) : '—', 'uses the ad spend entered below')}
        {t('Saved searches', String(d.saved_searches.total), `${d.saved_searches.with_alerts} with alerts · ${d.saved_searches.members} members`)}
        {t('Unlock clicks → offer', `${d.funnel.unlock_clicks} → ${d.funnel.offer_views}`, `${d.funnel.locked_listing_views} locked listing views`)}
        {t('Offer → checkout → join', `${pct(d.funnel.checkout_starts, d.funnel.offer_views)} → ${pct(d.funnel.joins, d.funnel.checkout_starts)}`, `${d.funnel.checkout_starts} checkouts · ${d.funnel.joins} joins`)}
      </div>
      <table className="adm-table" style={{ marginTop: 18 }}>
        <thead><tr><th>Finder funnel ({days}d)</th><th>Count</th></tr></thead>
        <tbody>
          {([
            ['Finder opened (sessions)', d.funnel.finder_opened], ['Location set', d.funnel.location_set], ['Searches', d.funnel.finder_searches],
            ['Locked listing views', d.funnel.locked_listing_views], ['Unlock Access clicks', d.funnel.unlock_clicks], ['Membership offer views', d.funnel.offer_views],
            ['Checkouts started', d.funnel.checkout_starts], ['$5 memberships started (Stripe-verified)', d.funnel.joins],
            ['Premium listings viewed unlocked', d.funnel.premium_listings_unlocked], ['Members who reached a $19.99 renewal (all time)', d.funnel.reached_first_renewal],
          ] as [string, number][]).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
        </tbody>
      </table>
      {d.listings.coverage.length > 0 && (
        <table className="adm-table" style={{ marginTop: 18 }}>
          <thead><tr><th>Listing coverage</th><th>Listings</th><th>Verified second-chance</th></tr></thead>
          <tbody>{d.listings.coverage.map((c) => <tr key={c.k}><td>{c.k}</td><td>{c.n}</td><td>{c.verified}</td></tr>)}</tbody>
        </table>
      )}
      <p className="muted" style={{ marginTop: 14 }}>
        Listings: {d.listings.by_classification.map((c) => `${c.n} ${c.k.replace(/_/g, ' ')}`).join(' · ') || 'none yet'}
        {d.listings.needs_reverification ? ` · ${d.listings.needs_reverification} verified listing(s) not re-checked in 30 days` : ''}
      </p>
    </section>
  );
}

interface Listing { listing_id: string; classification: string; name: string; city: string; state: string; rent_cents: number | null; verified_at: string | null; source_url: string; needs_reverification: boolean }
const EMPTY = { listing_id: '', classification: 'verified_second_chance', name: '', address: '', city: '', state: '', rent: '', rent_max: '', beds: '', baths: '', phone: '', website: '', photo_url: '', description: '', screening_note: '', source_name: '', source_url: '', verified_at: new Date().toISOString().slice(0, 10) };

export function ListingsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<Listing[]>([]);
  const [f, setF] = useState(EMPTY);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch(`${env.apiBase}/admin/listings`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' })
      .then(async (r) => r.ok && setRows(((await r.json()) as { listings: Listing[] }).listings))
      .catch(() => undefined);
  }, [token]);
  useEffect(load, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    const { rent, rent_max, ...rest } = f;
    const r = await fetch(`${env.apiBase}/admin/listings`, {
      method: 'POST', credentials: 'omit', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...rest, listing_id: f.listing_id || undefined, rent_cents: rent ? Math.round(Number(rent) * 100) : null, rent_max_cents: rent_max ? Math.round(Number(rent_max) * 100) : null }),
    }).catch(() => null);
    const out = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok) {
      setMsg(`Saved ${out.listing_id}.`);
      setF(EMPTY);
      load();
    } else setMsg(out.error || 'Couldn’t save the listing.');
  }
  const field = (k: keyof typeof EMPTY, label: string, type = 'text') => (
    <label className="field" key={k}><span>{label}</span><input className="input" type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <section className="panel">
      <h2>RentReady listings</h2>
      <p className="muted" style={{ marginBottom: 16 }}>
        Add only listings you’re allowed to publish. Every listing needs its source page. Mark “verified second-chance” only when that source publishes flexible screening, quote it in the screening note, and record the date you checked.
      </p>
      <form onSubmit={save} className="adm-listing-form">
        <label className="field"><span>Classification</span>
          <select className="input" value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value })}>
            <option value="verified_second_chance">Verified second-chance</option><option value="standard">Standard listing</option>
            <option value="unknown">Screening criteria unknown</option><option value="unavailable">Temporarily unavailable</option>
          </select>
        </label>
        {field('name', 'Property name')}{field('address', 'Street address')}{field('city', 'City')}{field('state', 'State (2 letters)')}
        {field('rent', 'Advertised rent, lowest ($/month)', 'number')}{field('rent_max', 'Highest rent, if a range ($/month)', 'number')}{field('beds', 'Bedrooms (0 = studio)', 'number')}{field('baths', 'Bathrooms', 'number')}
        {field('phone', 'Phone')}{field('website', 'Property website (https)')}{field('photo_url', 'Photo URL you may use (https)')}
        {field('source_name', 'Source name')}{field('source_url', 'Source URL (https)')}{field('verified_at', 'Date verified', 'date')}
        <label className="field adm-wide"><span>Screening note (what the source says)</span><textarea className="input" rows={2} value={f.screening_note} onChange={(e) => setF({ ...f, screening_note: e.target.value })} /></label>
        <label className="field adm-wide"><span>Description</span><textarea className="input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div className="adm-wide"><button className="btn btn-sm" disabled={busy}>{busy ? 'Saving…' : f.listing_id ? 'Update listing' : 'Add listing'}</button> {msg && <span className="muted" role="status">{msg}</span>}</div>
      </form>
      {rows.length > 0 && (
        <table className="adm-table" style={{ marginTop: 20 }}>
          <thead><tr><th>Listing</th><th>Type</th><th>Rent</th><th>Verified</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.listing_id}>
                <td><a href={`/finder/listing/${l.listing_id}`} target="_blank" rel="noreferrer">{l.name}</a><br /><small className="muted">{l.city}, {l.state}</small></td>
                <td>{l.classification.replace(/_/g, ' ')}</td>
                <td>{l.rent_cents != null ? money(l.rent_cents) : '—'}</td>
                <td>{l.verified_at || '—'}{l.needs_reverification && <><br /><small style={{ color: '#9b3b2b' }}>re-check due</small></>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
