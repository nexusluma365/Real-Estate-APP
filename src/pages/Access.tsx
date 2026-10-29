import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { Alert, Loader, Spinner, useOnce } from '../components/ui';
import { Icon } from '../components/Icon';
import { SharePanel } from '../components/Share';
import { PRODUCTS } from '../config/products';
import { SITE } from '../config/site';
import { RESOURCES, type Resource } from '../config/resources';
import { loadAssessment } from '../lib/assessmentStore';
import { requestAccessLink } from '../lib/entitlementService';
import { getDownloadUrl } from '../lib/fileService';
import { getMockOutbox, emitLifecycle } from '../lib/lifecycle';
import { track } from '../lib/analytics';
import { env, isMock } from '../lib/env';
import { read, write } from '../lib/storage';
import { validateEmail } from '../lib/validation';
import { useFunnel } from '../state/FunnelContext';

const STEPS = [
  { id: 'credit', title: 'Credit review', body: 'Pull all three reports and mark items to review.', to: '/gameplan#sec-credit' },
  { id: 'docs', title: 'Documents', body: 'Gather the documents in your plan into one folder.', to: '/gameplan#sec-documents' },
  { id: 'questions', title: 'Property questions', body: 'Ask before you pay any application fee.', to: '/gameplan#sec-questions' },
  { id: 'apply', title: 'Application preparation', body: 'Check that every number and address matches.', to: '/gameplan#sec-actions' },
];

export default function Access() {
  const { entitlements, owns, firstName } = useFunnel();
  if (entitlements.status === 'loading') return <Loader label="Loading your access" />;
  if (owns('creditready')) return <Home firstName={firstName} hasPlaybook={owns('playbook')} />;
  if (owns('guide')) return <GuideHome firstName={firstName} />;
  return <SignIn />;
}

/** Shown when /api/files sends a customer back here instead of downloading (see netlify/lib/api/files.ts). */
function DownloadNotice() {
  const reason = new URLSearchParams(window.location.search).get('download');
  const text = {
    signin: 'Sign in with the email you used at checkout to download your files.',
    not_owned: 'That file isn’t included in the purchase on this account. Sign in with the email you used at checkout.',
    unavailable: `That download isn’t available right now. Please try again in a few minutes${SITE.supportEmail ? ` or email ${SITE.supportEmail}` : ''}.`,
  }[reason || ''];
  return text ? <div style={{ marginTop: 16 }}><Alert kind="info">{text}</Alert></div> : null;
}

/** Opens an entitlement-checked product file (signed URL in production, a notice in mock mode). */
function useResourceOpener() {
  const [notice, setNotice] = useState('');
  async function open(r: Resource) {
    track('product_download', { product: r.product, resource: r.id });
    void emitLifecycle('product_accessed', { resource: r.id });
    try {
      const url = await getDownloadUrl(r.fileKey);
      if (url) window.location.assign(url);
      else setNotice(`“${r.title}” — product file delivery connects here (mock mode). See INTEGRATION_GUIDE.md → Product files.`);
    } catch {
      setNotice('That file didn’t open. Try again, or contact support if it keeps happening.');
    }
  }
  return { open, notice };
}

/** Book owners: their book is shipping, plus a quiet credited path to the Digital Bundle. */
function GuideHome({ firstName }: { firstName: string }) {
  return (
    <Layout chrome="customer">
      <Seo title="My RentReady access" noindex />
      <section className="access-head">
        <div className="wrap">
          <h1 style={{ fontSize: 'var(--step-5)' }}>Welcome{firstName ? `, ${firstName}` : ''}.</h1>
          <p className="lede" style={{ marginTop: 12, color: '#e3dccf' }}>Your copy of Before They Say No™ is on its way.</p>
          <DownloadNotice />
        </div>
      </section>
      <section className="band" style={{ paddingTop: 36 }}>
        <div className="wrap stack" style={{ ['--s' as string]: '24px', maxWidth: 760 }}>
          <section className="panel" aria-labelledby="res-h">
            <h2 id="res-h">{PRODUCTS.guide.name}</h2>
            <div className="prod-row" style={{ gridTemplateColumns: '28px 1fr' }}>
              <Icon name="home" />
              <p className="muted" style={{ fontSize: '0.95rem' }}>
                Your physical copy ships to the address you entered at checkout.{env.physicalDeliveryNote && ` ${env.physicalDeliveryNote}`} Questions about
                delivery? Email <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>.
              </p>
            </div>
          </section>
          <section className="panel" aria-labelledby="kit-h">
            <h2 id="kit-h">Add the dispute letters and video guide — your {PRODUCTS.guide.priceLabel} counts</h2>
            <p className="muted" style={{ margin: '6px 0 16px' }}>
              Upgrade to the RentReady Digital Bundle for {PRODUCTS.upgrade.priceLabel}: 20 Essential Credit Dispute Letter
              templates you can edit in Microsoft Word, and a step-by-step video guide showing how to dispute negative items.
              Both unlock right away — you already have the book.
            </p>
            <Link className="btn btn-sm" to="/checkout?product=upgrade" onClick={() => track('primary_cta_click', { cta_location: 'access_upgrade', product: 'upgrade' })}>
              Upgrade for {PRODUCTS.upgrade.priceLabel}
            </Link>
          </section>
          {isMock && <DevPanel />}
        </div>
      </section>
    </Layout>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  async function submit(e: FormEvent) {
    e.preventDefault();
    const v = validateEmail(email);
    if (v) return setErr(v);
    setErr('');
    setState('sending');
    try {
      await requestAccessLink(email);
      setState('sent');
    } catch {
      setState('error');
    }
  }
  return (
    <Layout>
      <Seo title="Customer access | RentReady" noindex />
      <div className="state-page">
        <div className="state-card" style={{ textAlign: 'left', width: '100%', maxWidth: 460 }}>
          <h1 style={{ fontSize: 'var(--step-4)' }}>Find your RentReady access.</h1>
          <p className="muted" style={{ marginTop: 12 }}>Enter the email you used at checkout. We’ll send a secure link that opens your access on this device.</p>
          {/[?&]link=(expired|invalid)/.test(window.location.search) && (
            <div style={{ marginTop: 16 }}><Alert kind="info">That sign-in link has expired or was already used. Request a new one below.</Alert></div>
          )}
          <DownloadNotice />
          {state === 'sent' ? (
            <div style={{ marginTop: 24 }}>
              <Alert kind="ok">If that email has a RentReady purchase, a sign-in link is on its way. It expires in 30 minutes.</Alert>
              {isMock && <p className="fine" style={{ marginTop: 12 }}>Development mode: no email is sent. Access in mock mode lives in this browser after a simulated checkout.</p>}
            </div>
          ) : (
            <form className="form" style={{ marginTop: 24 }} onSubmit={submit} noValidate>
              {state === 'error' && <Alert kind="error">We couldn’t send a link right now. Try again in a minute.</Alert>}
              <div className="field">
                <label htmlFor="ae">Email</label>
                <input id="ae" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!err} aria-describedby={err ? 'ae-err' : undefined} />
                {err && <span id="ae-err" className="field-error">{err}</span>}
              </div>
              <button className="btn btn-block" disabled={state === 'sending'}>{state === 'sending' ? <><Spinner /> Sending</> : 'Email me a sign-in link'}</button>
            </form>
          )}
          <p className="fine" style={{ marginTop: 24 }}>
            New to RentReady? <Link to="/">See how it works</Link>.
          </p>
        </div>
      </div>
    </Layout>
  );
}

function Home({ firstName, hasPlaybook }: { firstName: string; hasPlaybook: boolean }) {
  const a = loadAssessment();
  const assessmentState = a.completedAt ? 'complete' : Object.keys(a.answers).length ? 'progress' : 'none';
  const [done, setDone] = useState<Record<string, boolean>>(() => read('next_steps', {}));
  const { open, notice } = useResourceOpener();
  const doneCount = STEPS.filter((s) => done[s.id]).length;

  useOnce(() => {
    if (!read<boolean>('returned_tracked', false, 'session')) {
      write('returned_tracked', true, 'session');
      track('customer_returned');
    }
  });

  function toggle(id: string) {
    const next = { ...done, [id]: !done[id] };
    setDone(next);
    write('next_steps', next);
  }

  // Mirrors the planned re-engagement emails, shown in-app
  const reminder =
    assessmentState === 'none'
      ? { t: 'Start with your video guide', b: 'It shows how to dispute items you believe are inaccurate and how to use your 20 letter templates. Then take the 5-minute assessment for your game plan.', to: '/access#res-h', cta: 'Go to my videos' }
      : assessmentState === 'progress'
        ? { t: 'Finish your RentReady plan', b: 'You’re partway through your assessment. Pick up where you left off.', to: '/assessment', cta: 'Continue assessment' }
        : { t: 'Before you apply, review these questions', b: 'Ask the leasing office these before paying an application fee.', to: '/gameplan#sec-questions', cta: 'Review questions' };

  return (
    <Layout chrome="customer">
      <Seo title="My RentReady access" noindex />
      <section className="access-head">
        <div className="wrap">
          <h1 style={{ fontSize: 'var(--step-5)' }}>Welcome back{firstName ? `, ${firstName}` : ''}.</h1>
          <p className="lede" style={{ marginTop: 12, color: '#e3dccf' }}>Everything for the apartment you want, in one place.</p>
          <DownloadNotice />
        </div>
      </section>

      <section className="band" style={{ paddingTop: 36 }}>
        <div className="wrap">
          <div className="panel" style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center', borderColor: 'var(--brass)' }}>
            <div>
              <h2 style={{ fontSize: 'var(--step-1)', marginBottom: 4 }}>{reminder.t}</h2>
              <p className="muted">{reminder.b}</p>
            </div>
            <Link className="btn btn-sm" to={reminder.to}>{reminder.cta}</Link>
          </div>

          <div className="access-grid">
            <div className="stack" style={{ ['--s' as string]: '24px' }}>
              <section className="panel" aria-labelledby="prod-h">
                <h2 id="prod-h">My products</h2>
                <div className="prod-row">
                  <span className="mini-book cr">Digital<br />Bundle</span>
                  <div>
                    <strong>{PRODUCTS.creditready.name}</strong>
                    <p className="muted" style={{ fontSize: '0.95rem' }}>Your book (shipping to you), 20 dispute letter templates and the step-by-step video guide.</p>
                  </div>
                </div>
                <div className="prod-row">
                  <span className={`mini-book pm${hasPlaybook ? '' : ' off'}`}>PM<br />Playbook</span>
                  <div>
                    <strong>{PRODUCTS.playbook.name}</strong>
                    {hasPlaybook ? (
                      <p className="muted" style={{ fontSize: '0.95rem' }}>Rental screening, from the other side of the desk.</p>
                    ) : (
                      <p className="muted" style={{ fontSize: '0.95rem' }}>
                        Not purchased. <Link to="/complete-your-system">About the Playbook</Link>
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <section className="panel" aria-labelledby="res-h">
                <h2 id="res-h">Resources</h2>
                {notice && <div style={{ marginBottom: 14 }}><Alert kind="info">{notice}</Alert></div>}
                <div className="resources">
                  {RESOURCES.filter((r) => r.product === 'creditready' || (r.product === 'playbook' && hasPlaybook)).map((r) => (
                    <button key={r.id} className="res" type="button" onClick={() => open(r)}>
                      <Icon name={r.icon} />
                      <span>{r.title}<small>{r.kind}</small></span>
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="stack" style={{ ['--s' as string]: '24px' }}>
              <section className="panel" aria-labelledby="plan-h">
                <h2 id="plan-h">My RentReady plan</h2>
                <div className="prod-row" style={{ gridTemplateColumns: '1fr auto' }}>
                  <span>Assessment</span>
                  <span className={`tag ${assessmentState === 'complete' ? 'tag-strong' : 'tag-neutral'}`}>
                    {assessmentState === 'complete' ? 'Complete' : assessmentState === 'progress' ? 'In progress' : 'Not started'}
                  </span>
                </div>
                <div className="prod-row" style={{ gridTemplateColumns: '1fr auto' }}>
                  <span>Action plan</span>
                  {assessmentState === 'complete' ? <Link to="/gameplan">View plan</Link> : <Link to="/assessment">Build it</Link>}
                </div>
                <div className="prod-row" style={{ gridTemplateColumns: '1fr', gap: 8 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>Progress</span><span className="muted">{doneCount} of {STEPS.length} steps</span></span>
                  <div className="progress"><span style={{ width: `${(doneCount / STEPS.length) * 100}%` }} /></div>
                </div>
              </section>

              <section className="panel" aria-labelledby="steps-h">
                <h2 id="steps-h">My next steps</h2>
                <ul className="next-steps">
                  {STEPS.map((s) => (
                    <li key={s.id}>
                      <button className="tick" aria-pressed={!!done[s.id]} aria-label={`Mark “${s.title}” ${done[s.id] ? 'not done' : 'done'}`} onClick={() => toggle(s.id)}>
                        <Icon name="check" />
                      </button>
                      <span>
                        <strong>{s.title}</strong>
                        <br />
                        <span className="muted" style={{ fontSize: '0.92rem' }}>{s.body}</span>
                      </span>
                      {assessmentState === 'complete' && <Link to={s.to} aria-label={`Open ${s.title} in your plan`}>Open</Link>}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>

          {assessmentState === 'complete' && (
            <div style={{ marginTop: 32 }}>
              <SharePanel />
            </div>
          )}

          {isMock && <DevPanel />}
        </div>
      </section>
    </Layout>
  );
}

function DevPanel() {
  const outbox = getMockOutbox();
  return (
    <details className="panel" style={{ marginTop: 32, borderStyle: 'dashed' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Development tools</summary>
      <p className="fine" style={{ margin: '12px 0' }}>Lifecycle events captured for future email flows (not sent):</p>
      <ul className="fine" style={{ maxHeight: 180, overflow: 'auto' }}>
        {outbox.length === 0 && <li>None yet.</li>}
        {outbox.slice().reverse().map((o, i) => (
          <li key={i}>{o.at.slice(11, 19)} — {o.event}</li>
        ))}
      </ul>
      <button
        className="btn btn-sm btn-outline"
        style={{ marginTop: 12 }}
        onClick={() => {
          Object.keys(localStorage).filter((k) => k.startsWith('rr.')).forEach((k) => localStorage.removeItem(k));
          Object.keys(sessionStorage).filter((k) => k.startsWith('rr.')).forEach((k) => sessionStorage.removeItem(k));
          location.href = '/';
        }}
      >
        Reset demo data
      </button>
    </details>
  );
}
