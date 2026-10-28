import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { Alert, Checklist, Spinner, useOnce } from '../components/ui';
import { ProductStage } from '../components/Visuals';
import { ScenarioCard } from '../components/Content';
import { Icon } from '../components/Icon';
import { dollars, PLAYBOOK_CHAPTERS, PRODUCTS } from '../config/products';
import { env, isMock } from '../lib/env';
import { track, trackPurchase } from '../lib/analytics';
import { emitLifecycle } from '../lib/lifecycle';
import { attemptKey, chargeUpsell, getSavedMethodLabel, resetAttemptKey, verifyPaymentServerSide } from '../lib/paymentService';
import { loadStripe } from '../lib/stripe';
import type { MockOutcome, UpsellStatus } from '../lib/types';
import { useFunnel } from '../state/FunnelContext';

const P = PRODUCTS.playbook;
const ACCEPT = `Yes — add the Property Manager Playbook for ${P.priceLabel}`;
const DECLINE = 'No thanks — take me to my Digital Bundle';

/** Honest positioning: what the Bundle already covers vs. what only the Playbook adds. */
const YOUR_SIDE = ['Before They Say No™ — the physical book', '20 Essential Credit Dispute Letter templates (Microsoft Word)', 'Step-by-step video guide on disputing negative items'];
const THEIR_SIDE = ['How screening criteria and rent-to-income rules are commonly written', 'Three sample applications, reviewed the way a property might', 'Questions to ask the leasing office before paying a fee', 'Documentation checklist by employment type', 'What to do after a denial: adverse action notices and screening reports', 'A property-specific application worksheet', 'Expanded sections in your game plan'];

export default function Upsell() {
  const { owns, refreshEntitlements, firstName } = useFunnel();
  const navigate = useNavigate();
  const [status, setStatus] = useState<UpsellStatus>('ready');
  const [message, setMessage] = useState('');
  const [mockOutcome, setMockOutcome] = useState<MockOutcome>('success');
  const pending = useRef<{ pi: string; secret: string } | null>(null);
  const inFlight = useRef(false);
  useOnce(() => track('upsell_view', { product: 'playbook', order_value: dollars(P.priceCents) }));

  if (owns('playbook') && status !== 'success') return <Navigate to="/welcome" replace />;

  async function complete(pi: string) {
    const v = await verifyPaymentServerSide(pi, 'playbook');
    if (!v.verified) throw new Error('unverified');
    await refreshEntitlements();
    trackPurchase('upsell', 'playbook', v.order?.amount_cents ?? P.priceCents, v.order?.order_id);
    resetAttemptKey('pm');
    setStatus('success');
    navigate('/welcome', { replace: true });
  }

  function fail(kind: 'declined' | 'error', msg: string) {
    inFlight.current = false;
    resetAttemptKey('pm'); // a retry is a new, deliberate attempt — don't replay the failed idempotent response
    setStatus(kind);
    setMessage(msg);
    track('upsell_purchase_failed', { product: 'playbook', reason: kind });
    void emitLifecycle('upsell_failed', { reason: kind });
  }

  /** The ONLY code path that can charge the saved card — and only from this explicit click. */
  async function accept() {
    if (inFlight.current) return;
    inFlight.current = true;
    track('upsell_accept_click', { product: 'playbook' });
    setStatus('processing');
    setMessage('');
    const r = await chargeUpsell({ idempotencyKey: attemptKey('pm'), mockOutcome });
    try {
      if (r.status === 'succeeded') return await complete(r.payment_intent_id);
      if (r.status === 'requires_action') {
        pending.current = { pi: r.payment_intent_id, secret: r.client_secret };
        inFlight.current = false;
        setStatus('requires_action');
        return;
      }
      fail(r.status, r.message);
    } catch {
      fail('error', 'We couldn’t confirm that purchase. You have not been charged twice. Try again or continue without it.');
    }
  }

  async function authenticate() {
    if (!pending.current || inFlight.current) return;
    inFlight.current = true;
    setStatus('processing');
    try {
      if (isMock) return await complete(pending.current.pi);
      const s = await loadStripe();
      const { error, paymentIntent } = await s.handleNextAction({ clientSecret: pending.current.secret });
      if (error || !paymentIntent || paymentIntent.status !== 'succeeded') return fail('declined', error?.message || 'Your bank didn’t confirm this purchase.');
      await complete(paymentIntent.id);
    } catch {
      fail('error', 'We couldn’t reach your bank. You have not been charged.');
    }
  }

  function decline() {
    if (inFlight.current) return;
    track('upsell_decline_click', { product: 'playbook' });
    void emitLifecycle('upsell_declined');
    navigate('/welcome', { replace: true });
  }

  const busy = status === 'processing' || status === 'success';

  const decisionBlock = (id: string) => (
    <div className="decision" aria-labelledby={`${id}-h`}>
      <div>
        <h2 id={`${id}-h`} style={{ fontSize: 'var(--step-2)' }}>{P.name}</h2>
        <div className="price-line"><span className="price" style={{ fontSize: '3rem' }}>{P.priceLabel}</span><span className="price-meta">one time</span></div>
      </div>
      {status === 'requires_action' ? (
        <>
          <Alert kind="info">Your bank needs to confirm this purchase. You won’t be charged unless you approve it.</Alert>
          <button className="btn btn-block" onClick={authenticate} disabled={busy}>Confirm with my bank</button>
        </>
      ) : (
        <>
          {(status === 'declined' || status === 'error') && <Alert kind="error">{message}</Alert>}
          <button className="btn btn-block" onClick={accept} disabled={busy} aria-busy={busy}>
            {busy ? <><Spinner /> Adding the Playbook</> : status === 'declined' || status === 'error' ? 'Try again' : ACCEPT}
          </button>
          <p className="fine" style={{ textAlign: 'center', marginTop: -6 }}>
            Uses my saved payment method ({getSavedMethodLabel()}). One-time charge of {P.priceLabel}. Nothing is charged unless I click.{' '}
            {env.moneyBackDays > 0 && `Covered by the same ${env.moneyBackDays}-day money-back guarantee.`}
          </p>
        </>
      )}
      <button className="decline" onClick={decline} disabled={busy}>{DECLINE}</button>
      {isMock && id === 'top' && status !== 'requires_action' && (
        <fieldset className="dev-sim">
          <legend>Development upsell simulator</legend>
          <div className="opts">
            {(['success', 'decline', 'requires_action', 'network_error'] as MockOutcome[]).map((o) => (
              <label key={o}>
                <input type="radio" name="mock-up" checked={mockOutcome === o} onChange={() => setMockOutcome(o)} />
                {{ success: 'Approve', decline: 'Declined', requires_action: 'Needs bank confirmation', network_error: 'Error' }[o]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );

  return (
    <Layout chrome="focused">
      <Seo title="Complete your RentReady system" noindex />

      <section className="upsell-hero">
        <div className="wrap">
          <div className="stack" style={{ ['--s' as string]: '22px' }}>
            <span className="receipt-note"><Icon name="check" width={16} height={16} /> {firstName ? `${firstName}, your` : 'Your'} Digital Bundle order is confirmed. Your letters and videos are ready.</span>
            <span className="wait">WAIT</span>
            <h1 style={{ fontSize: 'var(--step-5)' }}>You’re only seeing half the application.</h1>
            <p className="lede" style={{ color: '#e3dccf' }}>
              Your Bundle prepares your side of the application. The Playbook shows you the other side — how a property may
              read it — so you can choose where to apply and what to bring.
            </p>
          </div>
          {decisionBlock('top')}
        </div>
      </section>

      <section className="band" aria-labelledby="pm-h">
        <div className="wrap grid-2">
          <ProductStage kind="playbook" />
          <div className="stack">
            <h2 id="pm-h">See your application from the other side of the desk.</h2>
            <p className="lede">Most renters only see the application. The Playbook helps you understand what can happen on the other side of it.</p>
            <p className="muted">
              It explains how rental screening commonly works — income requirements, credit and screening reports, rental
              history, verification and documents — so you can read a property’s criteria, ask better questions, and
              prepare an application that holds together. Every property sets its own requirements; this teaches you how
              to find and work with them.
            </p>
          </div>
        </div>
      </section>

      <section className="band band-paper band-rule" aria-labelledby="diff-h">
        <div className="wrap">
          <h2 id="diff-h" className="measure">What’s new here — and what you already have.</h2>
          <p className="lede muted" style={{ marginTop: 14 }}>We won’t sell you something twice. Here’s the line between the two.</p>
          <div className="sides">
            <div className="side side-you">
              <span className="kicker">Already in your Digital Bundle</span>
              <h3>Your side of the application</h3>
              <ul>{YOUR_SIDE.map((t) => <li key={t}><Icon name="check" /><span>{t}</span></li>)}</ul>
            </div>
            <div className="side-desk" aria-hidden="true">the desk</div>
            <div className="side side-them">
              <span className="kicker">Only in the Playbook</span>
              <h3>The property’s side</h3>
              <ul>{THEIR_SIDE.map((t) => <li key={t}><Icon name="check" /><span>{t}</span></li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      <section className="band band-ink" aria-labelledby="ch-h">
        <div className="wrap">
          <h2 id="ch-h" className="measure">Ten chapters, in the order an application is reviewed.</h2>
          <ol className="modules two-col">
            {PLAYBOOK_CHAPTERS.map((c) => (
              <li key={c.title}><div><h3>{c.title}</h3><p>{c.body}</p></div></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band" aria-labelledby="ex-h">
        <div className="wrap">
          <h2 id="ex-h" className="measure">Three sample applications.</h2>
          <p className="lede muted" style={{ marginTop: 14 }}>
            Hypothetical examples. They show what may be considered — not what any property would decide.
          </p>
          <div className="scenario-trio">
            <ScenarioCard
              title="A — High income, fair credit"
              rows={[
                { label: 'Rent / income', value: '$1,800 / $7,500', rating: 'strong' },
                { label: 'Credit range', value: '600–619', rating: 'attention' },
                { label: 'Rental history', value: 'Positive', rating: 'strong' },
              ]}
              note="Income may be a strength, while credit falls below some published minimums. Worth asking: does the property offer conditional approval, such as a larger deposit?"
            />
            <ScenarioCard
              title="B — Great credit, income short"
              rows={[
                { label: 'Rent / income', value: '$2,400 / $6,000', rating: 'attention' },
                { label: 'Credit range', value: '740+', rating: 'strong' },
                { label: 'Property requires', value: '3× rent' },
              ]}
              note="At 2.5×, this applicant is below this hypothetical property’s published 3× requirement. Strong credit may not offset a written income rule — a co-applicant or guarantor might."
            />
            <ScenarioCard
              title="C — Strong income, a collection"
              rows={[
                { label: 'Rent / income', value: '$2,000 / $8,000', rating: 'strong' },
                { label: 'Credit range', value: '660–679', rating: 'review' },
                { label: 'Collection', value: 'Prior utility', rating: 'review' },
              ]}
              note="A utility collection may be reviewed more closely by some properties. If it’s inaccurate, dispute it early. If accurate, be ready with a brief explanation and any proof of payment."
            />
          </div>
        </div>
      </section>

      <section className="band band-paper band-rule" aria-labelledby="pinc-h">
        <div className="wrap grid-2">
          <div className="stack">
            <h2 id="pinc-h">What you’ll get</h2>
            <Checklist items={P.includes} />
            <p className="fine">
              Educational resource about common rental screening practices. Not affiliated with any property manager or
              screening company. Requirements vary by property, and no approval is guaranteed.
            </p>
          </div>
          {decisionBlock('bottom')}
        </div>
      </section>
    </Layout>
  );
}
