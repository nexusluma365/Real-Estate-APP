import { ListingsPanel, PremiumPanel } from '../components/AdminPremium';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { Alert, Spinner } from '../components/ui';
import { PRODUCTS } from '../config/products';
import { env, isMock } from '../lib/env';
import { getDebugEvents } from '../lib/analytics';
import { getMockOutbox } from '../lib/lifecycle';
import { read, write } from '../lib/storage';
import { money } from '../lib/validation';
import type { Order, ProductId } from '../lib/types';

/**
 * Funnel dashboard. Data comes ONLY from GET /api/admin/metrics (Bearer ADMIN_TOKEN, held in sessionStorage
 * for this tab). Mock mode shows what this browser simulated, clearly labelled — never presented as real.
 * Ad spend and unit costs are typed in here (no ad-platform API is connected), so CPL/CAC/ROAS are derived.
 */
interface Metrics {
  source: 'live' | 'sample';
  days: number;
  visitors: number;
  leads: number;
  qualStarted: number;
  qualCompleted: number;
  productViews: number;
  checkoutViews: number;
  checkoutStarts: number;
  abandoned: number;
  recovered: number;
  tiers: { k: string | null; n: number }[];
  products: { k: string; n: number; gross: number; refunded: number; refunds: number }[];
  bySource: { k: string; customers: number; net: number }[];
  leadsBySource: { k: string; n: number }[];
}

function sampleFromThisBrowser(): Metrics {
  const orders = read<Order[]>('mock.orders', []);
  const ev = getDebugEvents();
  const count = (e: string) => (ev.some((x) => x.event === e) ? 1 : 0);
  const outbox = getMockOutbox();
  const by = new Map<string, { n: number; gross: number }>();
  orders.forEach((o) => {
    const r = by.get(o.product) || { n: 0, gross: 0 };
    by.set(o.product, { n: r.n + 1, gross: r.gross + o.amount_cents });
  });
  const lead = read<{ qualification?: { intent_tier: string } } | null>('lead', null);
  return {
    source: 'sample',
    days: 0,
    visitors: 1,
    leads: lead ? 1 : 0,
    qualStarted: count('qualification_started'),
    qualCompleted: count('qualification_completed'),
    productViews: count('product_view'),
    checkoutViews: count('checkout_view'),
    checkoutStarts: outbox.some((o) => o.event === 'checkout_started') ? 1 : 0,
    abandoned: 0,
    recovered: 0,
    tiers: lead?.qualification ? [{ k: lead.qualification.intent_tier, n: 1 }] : [],
    products: [...by.entries()].map(([k, v]) => ({ k, ...v, refunded: 0, refunds: 0 })),
    bySource: orders.length ? [{ k: '(this browser)', customers: 1, net: orders.reduce((s, o) => s + o.amount_cents, 0) }] : [],
    leadsBySource: [],
  };
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

export default function Admin() {
  const [token, setToken] = useState(() => read<string>('admin_token', '', 'session'));
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Metrics | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [checked, setChecked] = useState(0);
  const [costs, setCosts] = useState(() => read('admin_costs', { spend: '', kitCost: '', feePct: '2.9', feeFixed: '0.30' }));

  async function load(e?: FormEvent) {
    e?.preventDefault();
    if (isMock) {
      setData(sampleFromThisBrowser());
      return;
    }
    setState('loading');
    setErr('');
    setChecked((n) => n + 1);
    try {
      const r = await fetch(`${env.apiBase}/admin/metrics?days=${days}`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' });
      if (!r.ok) throw new Error(r.status === 401 ? 'That token wasn’t accepted.' : r.status === 501 ? 'Metrics aren’t configured (ADMIN_TOKEN / DB).' : `Error ${r.status}`);
      write('admin_token', token, 'session');
      setData({ ...((await r.json()) as Metrics), source: 'live' });
      setState('idle');
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Couldn’t load metrics.');
      setState('error');
    }
  }

  function setCost(k: keyof typeof costs, v: string) {
    const next = { ...costs, [k]: v };
    setCosts(next);
    write('admin_costs', next);
  }

  const d = data;
  const sum = (f: (p: Metrics['products'][number]) => number) => (d ? d.products.reduce((s, p) => s + f(p), 0) : 0);
  const gross = sum((p) => p.gross);
  const refunded = sum((p) => p.refunded);
  const net = gross - refunded;
  const frontOrders = d ? d.products.filter((p) => p.k === 'guide' || p.k === 'creditready').reduce((s, p) => s + p.n, 0) : 0;
  const allOrders = sum((p) => p.n);
  const upsell = d?.products.find((p) => p.k === 'playbook');
  const kits = d ? d.products.filter((p) => p.k === 'creditready' || p.k === 'upgrade').reduce((s, p) => s + p.n, 0) : 0;
  const spendCents = Math.round((Number(costs.spend) || 0) * 100);
  const fees = Math.round(gross * (Number(costs.feePct) || 0) / 100 + allOrders * (Number(costs.feeFixed) || 0) * 100);
  const fulfil = Math.round(kits * (Number(costs.kitCost) || 0) * 100);
  const high = d?.tiers.find((t) => t.k === 'high')?.n ?? 0;
  const tierTotal = d?.tiers.reduce((s, t) => s + t.n, 0) ?? 0;

  return (
    <Layout chrome="focused">
      <Seo title="Funnel dashboard | RentReady" noindex />
      <section className="band" style={{ paddingTop: 40 }}>
        <div className="wrap stack" style={{ ['--s' as string]: '24px' }}>
          <h1 style={{ fontSize: 'var(--step-4)' }}>Funnel dashboard</h1>
          <form className="panel adm-auth" onSubmit={load}>
            {!isMock && (
              <div className="field" style={{ flex: '1 1 260px' }}>
                <label htmlFor="adm-t">Admin token</label>
                <input id="adm-t" className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label htmlFor="adm-d">Period</label>
              <select id="adm-d" className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[7, 30, 90, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}
              </select>
            </div>
            <button className="btn btn-sm" type="submit" disabled={state === 'loading'}>{state === 'loading' ? <><Spinner /> Loading</> : 'Load metrics'}</button>
          </form>
          {err && <Alert kind="error">{err}</Alert>}
          {!isMock && checked > 0 && <HealthPanel token={token} key={checked} />}
          {!d && !err && (
            <p className="muted">{isMock ? 'Mock mode: shows only what this browser simulated.' : 'No data loaded. Requires ADMIN_TOKEN and the Supabase database (see LAUNCH_CHECKLIST.md).'}</p>
          )}

          {d && (
            <>
              {d.source === 'sample' && <Alert kind="info">Sample data from this browser’s mock session — not real analytics.</Alert>}

              <div className="adm-tiles">
                <Tile label="Net revenue" value={money(net)} sub={refunded ? `${money(gross)} gross · ${money(refunded)} refunded` : `${allOrders} orders`} />
                <Tile label="Average order value" value={frontOrders ? money(Math.round(net / frontOrders)) : '—'} sub="Net revenue ÷ front-door orders" />
                <Tile label="Lead conversion" value={pct(d.leads, d.visitors)} sub={`${d.leads} leads / ${d.visitors} visitors`} />
                <Tile label="Visitor → buyer" value={pct(frontOrders, d.visitors)} sub={`${frontOrders} front-door orders`} />
                <Tile label="Upsell take rate" value={pct(upsell?.n ?? 0, kits)} sub={`${upsell?.n ?? 0} Playbooks · ${money(upsell?.gross ?? 0)}`} />
                <Tile label="High-intent leads" value={pct(high, tierTotal)} sub={`${tierTotal} leads answered the finder`} />
              </div>

              <section className="panel">
                <h2>Funnel</h2>
                <table className="adm-table">
                  <thead><tr><th>Step</th><th>Count</th><th>From previous</th></tr></thead>
                  <tbody>
                    {[
                      ['Visitors (sessions)', d.visitors],
                      ['Started the finder', d.qualStarted],
                      ['Completed the finder', d.qualCompleted],
                      ['Saw the product options', d.productViews],
                      ['Opened checkout', d.checkoutViews],
                      ['Reached the payment form (leads)', d.checkoutStarts],
                      ['Front-door orders', frontOrders],
                    ].map(([label, n], i, arr) => (
                      <tr key={label as string}><td>{label}</td><td>{n}</td><td>{i ? pct(n as number, arr[i - 1][1] as number) : '—'}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="fine" style={{ marginTop: 10 }}>The finder is optional, so “from previous” can exceed 100% on the steps after it.</p>
              </section>

              <div className="grid-2" style={{ gap: 24, alignItems: 'start' }}>
                <section className="panel">
                  <h2>Sales by product</h2>
                  <table className="adm-table">
                    <thead><tr><th>Product</th><th>Orders</th><th>Gross</th><th>Refunds</th></tr></thead>
                    <tbody>
                      {d.products.length === 0 && <tr><td colSpan={4} className="muted">No orders in this period.</td></tr>}
                      {d.products.map((p) => (
                        <tr key={p.k}><td>{PRODUCTS[p.k as ProductId]?.shortName || p.k}</td><td>{p.n}</td><td>{money(p.gross)}</td><td>{p.refunds} · {money(p.refunded)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </section>
                <section className="panel">
                  <h2>Recovery</h2>
                  <table className="adm-table">
                    <tbody>
                      <tr><td>Abandoned checkouts flagged</td><td>{d.abandoned}</td></tr>
                      <tr><td>Recovered (bought after flag)</td><td>{d.recovered} · {pct(d.recovered, d.abandoned)}</td></tr>
                      <tr><td>Checkout abandonment</td><td>{pct(Math.max(0, d.checkoutStarts - frontOrders), d.checkoutStarts)}</td></tr>
                    </tbody>
                  </table>
                  <p className="fine" style={{ marginTop: 10 }}>Opens and clicks live in your ESP.</p>
                </section>
              </div>

              <section className="panel">
                <h2>Revenue by traffic source</h2>
                <table className="adm-table">
                  <thead><tr><th>utm_source</th><th>Leads</th><th>Customers</th><th>Net revenue</th></tr></thead>
                  <tbody>
                    {d.bySource.length === 0 && <tr><td colSpan={4} className="muted">No orders in this period.</td></tr>}
                    {d.bySource.map((s) => (
                      <tr key={s.k}><td>{s.k}</td><td>{d.leadsBySource.find((l) => l.k === s.k)?.n ?? '—'}</td><td>{s.customers}</td><td>{money(s.net)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {d.source === 'live' && <PremiumPanel token={token} days={d.days} />}
              {d.source === 'live' && <ShippingPanel token={token} />}
              {d.source === 'live' && <ListingsPanel token={token} />}

              <section className="panel">
                <h2>Unit economics</h2>
                <p className="muted" style={{ marginBottom: 16 }}>No ad platform is connected, so enter spend for this period. Values stay in this browser.</p>
                <div className="adm-costs">
                  <Num label="Ad spend ($)" v={costs.spend} on={(v) => setCost('spend', v)} />
                  <Num label="Book + shipping per shipped order ($)" v={costs.kitCost} on={(v) => setCost('kitCost', v)} />
                  <Num label="Stripe % fee" v={costs.feePct} on={(v) => setCost('feePct', v)} />
                  <Num label="Stripe fixed fee ($)" v={costs.feeFixed} on={(v) => setCost('feeFixed', v)} />
                </div>
                <div className="adm-tiles" style={{ marginTop: 18 }}>
                  <Tile label="Cost per lead" value={spendCents && d.leads ? money(Math.round(spendCents / d.leads)) : '—'} />
                  <Tile label="Customer acquisition cost" value={spendCents && frontOrders ? money(Math.round(spendCents / frontOrders)) : '—'} />
                  <Tile label="Return on ad spend" value={spendCents ? `${(net / spendCents).toFixed(2)}×` : '—'} />
                  <Tile label="Contribution margin" value={money(net - fees - fulfil - spendCents)} sub={`after ~${money(fees)} fees, ${money(fulfil)} fulfilment, ad spend`} />
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </Layout>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="adm-tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function Num({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  const id = `adm-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" inputMode="decimal" value={v} onChange={(e) => on(e.target.value.replace(/[^\d.]/g, ''))} />
    </div>
  );
}

interface ShipOrder {
  payment_intent_id: string;
  product: ProductId;
  amount_cents: number;
  created_at: string;
  refunded_at: string | null;
  email: string | null;
  first_name: string | null;
  shipped: { carrier?: string; tracking?: string; at: string } | null;
  shipping: { name?: string; address?: Record<string, string | undefined> } | null;
}

/** Books to ship: address from Stripe, then "Mark shipped" emails the customer once (with tracking, if given). */
function ShippingPanel({ token }: { token: string }) {
  const [orders, setOrders] = useState<ShipOrder[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState<Record<string, { carrier: string; tracking: string; tracking_url: string }>>({});
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${env.apiBase}/admin/orders`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      setOrders(((await r.json()) as { orders: ShipOrder[] }).orders);
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Couldn’t load orders.');
    }
  }, [token]);
  useEffect(() => void load(), [load]);

  async function ship(id: string) {
    setBusy(id);
    setErr('');
    try {
      const r = await fetch(`${env.apiBase}/admin/orders`, { method: 'POST', headers, credentials: 'omit', body: JSON.stringify({ payment_intent_id: id, ...form[id] }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || `Error ${r.status}`);
      await load();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Couldn’t mark shipped.');
    }
    setBusy('');
  }
  const field = (id: string, k: 'carrier' | 'tracking' | 'tracking_url', v: string) =>
    setForm((f) => ({ ...f, [id]: { ...(f[id] || { carrier: '', tracking: '', tracking_url: '' }), [k]: v } }));
  const todo = orders?.filter((o) => !o.shipped && !o.refunded_at) ?? [];
  const done = orders?.filter((o) => o.shipped) ?? [];

  return (
    <section className="panel">
      <h2>Books to ship {orders && <span className="muted">({todo.length})</span>}</h2>
      {err && <Alert kind="error">{err}</Alert>}
      {!orders && !err && <p className="muted"><Spinner /> Loading orders…</p>}
      {orders && todo.length === 0 && <p className="muted" style={{ marginTop: 10 }}>Nothing waiting to ship.</p>}
      <div className="adm-ship">
        {todo.map((o) => {
          const a = o.shipping?.address || {};
          return (
            <div key={o.payment_intent_id} className="adm-ship-row">
              <div>
                <strong>{o.shipping?.name || o.first_name || '—'}</strong> · {PRODUCTS[o.product]?.shortName || o.product} · {new Date(o.created_at).toLocaleDateString()}
                <div className="muted">{o.email}</div>
                <div>{o.shipping ? [a.line1, a.line2, `${a.city || ''}, ${a.state || ''} ${a.postal_code || ''}`, a.country].filter(Boolean).join(' · ') : <span className="muted">Address: see Stripe payment {o.payment_intent_id}</span>}</div>
              </div>
              <div className="adm-ship-form">
                <input className="input" placeholder="Carrier (USPS)" value={form[o.payment_intent_id]?.carrier || ''} onChange={(e) => field(o.payment_intent_id, 'carrier', e.target.value)} />
                <input className="input" placeholder="Tracking number" value={form[o.payment_intent_id]?.tracking || ''} onChange={(e) => field(o.payment_intent_id, 'tracking', e.target.value)} />
                <input className="input" placeholder="Tracking link (https://…)" value={form[o.payment_intent_id]?.tracking_url || ''} onChange={(e) => field(o.payment_intent_id, 'tracking_url', e.target.value)} />
                <button className="btn btn-sm" type="button" disabled={busy === o.payment_intent_id} onClick={() => ship(o.payment_intent_id)}>
                  {busy === o.payment_intent_id ? <><Spinner /> Sending</> : 'Mark shipped + email customer'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {done.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary>Shipped ({done.length})</summary>
          <table className="adm-table">
            <tbody>
              {done.map((o) => (
                <tr key={o.payment_intent_id}><td>{o.email}</td><td>{o.shipped?.carrier} {o.shipped?.tracking}</td><td>{o.shipped && new Date(o.shipped.at).toLocaleDateString()}</td></tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

interface Health { settings: Record<string, boolean | string | null>; database: string; files: Record<string, string> }

/** Launch readiness from GET /api/admin/health — booleans and statuses only, never secret values. */
function HealthPanel({ token }: { token: string }) {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fetch(`${env.apiBase}/admin/health`, { headers: { Authorization: `Bearer ${token}` }, credentials: 'omit' })
      .then(async (r) => (r.ok ? setH((await r.json()) as Health) : setErr(r.status === 401 ? 'Token not accepted.' : `Error ${r.status}`)))
      .catch(() => setErr('Couldn’t reach the API.'));
  }, [token]);
  const ok = (v: unknown) => v === true || (typeof v === 'string' && /^(ok|uploaded|https?:)/.test(v));
  const rows: [string, unknown][] = h
    ? [...Object.entries(h.settings), ['database connection', h.database], ...Object.entries(h.files).map(([k, v]) => [`R2 file: ${k}`, v] as [string, unknown])]
    : [];
  return (
    <section className="panel">
      <h2>Setup health</h2>
      {err && <Alert kind="error">{err}</Alert>}
      {!h && !err && <p className="muted"><Spinner /> Checking…</p>}
      {h && (
        <table className="adm-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}><td>{k.replace(/_/g, ' ')}</td><td style={{ color: ok(v) ? 'var(--ok, #1d7a46)' : 'var(--attention)' }}>{v === true ? 'Set' : v === false ? 'Missing' : String(v)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
