import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { CtaLink, Tag, useOnce } from '../components/ui';
import { LockedNote } from '../components/Content';
import { SharePanel } from '../components/Share';
import { Icon } from '../components/Icon';
import { loadAssessment, resetAssessment } from '../lib/assessmentStore';
import { buildGamePlan } from '../lib/gameplan';
import { track } from '../lib/analytics';
import { emitLifecycle } from '../lib/lifecycle';
import { read, write } from '../lib/storage';
import { money } from '../lib/validation';
import { useFunnel } from '../state/FunnelContext';

export default function Gameplan() {
  const { firstName, owns } = useFunnel();
  const state = useMemo(loadAssessment, []);
  const plan = useMemo(() => (state.completedAt ? buildGamePlan(state.answers, firstName) : null), [state, firstName]);
  const full = owns('playbook');

  useOnce(() => {
    if (!plan) return;
    track('gameplan_viewed', { product: full ? 'bundle' : 'creditready' });
    if (!read<boolean>('gameplan_completed_sent', false)) {
      write('gameplan_completed_sent', true);
      void emitLifecycle('gameplan_completed');
    }
  });

  if (!plan) {
    return (
      <Layout chrome="customer">
        <Seo title="Your RentReady Game Plan" noindex />
        <div className="state-page">
          <div className="state-card stack">
            <div className="seal" style={{ color: 'var(--brass-deep)' }}><Icon name="compass" /></div>
            <h1 style={{ fontSize: 'var(--step-4)' }}>Your game plan starts with a few questions.</h1>
            <p className="muted">Answer the readiness assessment and we’ll build your plan from your answers. It takes about five minutes.</p>
            <div className="cta-row" style={{ justifyContent: 'center' }}>
              <CtaLink to="/assessment" props={{ cta_location: 'gameplan_empty' }}>
                {Object.keys(state.answers).length ? 'Continue my assessment' : 'Start my assessment'}
              </CtaLink>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout chrome="customer">
      <Seo title="Your RentReady Game Plan" noindex />
      <section className="plan-head">
        <div className="wrap">
          <span className="wordmark-eyebrow">RENTREADY GAME PLAN</span>
          <h1 style={{ fontSize: 'var(--step-5)', marginTop: 14 }}>{plan.firstName ? `${plan.firstName}’s plan` : 'Your plan'} for the apartment you want.</h1>
          <p className="lede" style={{ marginTop: 16, color: '#e3dccf' }}>
            Based on the information you provided. Individual property requirements vary.
          </p>
          <dl className="plan-summary">
            <div><dt>Target rent</dt><dd>{money(plan.targetRent * 100)}</dd></div>
            <div><dt>Gross monthly income</dt><dd>{money(plan.income * 100)}</dd></div>
            <div><dt>Income to rent</dt><dd>{plan.ratio !== null ? `${plan.ratio}×` : '—'}</dd></div>
          </dl>
          <div className="legend" aria-label="What the labels mean">
            <span className="legend-item"><Tag rating="strong" /> may be a strength</span>
            <span className="legend-item"><Tag rating="review" /> worth reviewing</span>
            <span className="legend-item"><Tag rating="attention" /> plan around this first</span>
          </div>
        </div>
      </section>

      <section className="band" style={{ paddingTop: 40 }}>
        <div className="wrap" style={{ maxWidth: 880 }}>
          <div className="plan-sections">
            {plan.sections.map((s) => (
              <article className="plan-sec" key={s.id} aria-labelledby={`sec-${s.id}`}>
                <div className="plan-sec-head">
                  <h2 id={`sec-${s.id}`}>{s.title}</h2>
                  {s.rating && <Tag rating={s.rating} />}
                </div>
                <p className="muted">{s.summary}</p>
                {s.id === 'actions' ? (
                  <ol>{s.points.map((p) => <li key={p}>{p}</li>)}</ol>
                ) : (
                  <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>
                )}
                {s.playbook &&
                  (full ? (
                    <div className="plan-extra">
                      <span className="kicker">From your Property Manager Playbook</span>
                      <ul>{s.playbook.extra.map((p) => <li key={p}>{p}</li>)}</ul>
                    </div>
                  ) : (
                    <LockedNote>
                      {s.playbook.extra.length} more items for this section are covered in the Property Manager Playbook.
                    </LockedNote>
                  ))}
              </article>
            ))}
          </div>

          <p className="fine" style={{ marginTop: 28 }}>
            This plan is educational and based only on information you provided. It is not a credit check, a screening
            result, or a prediction of any property’s decision. Requirements vary by property — always confirm a
            property’s written criteria.
          </p>

          <div className="cta-row" style={{ marginTop: 24 }}>
            <button className="btn btn-dark" onClick={() => window.print()}>Print or save as PDF</button>
            <Link to="/access" className="btn btn-outline">Go to my access</Link>
            <Link
              to="/assessment"
              className="text-link"
              onClick={() => {
                resetAssessment();
                write('gameplan_completed_sent', false);
              }}
            >
              Retake assessment
            </Link>
          </div>

          <div style={{ marginTop: 56 }}>
            <SharePanel />
          </div>
        </div>
      </section>
    </Layout>
  );
}
