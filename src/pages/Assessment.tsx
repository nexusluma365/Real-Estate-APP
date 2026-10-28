import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { Icon } from '../components/Icon';
import { promptOf, visibleQuestions, type Answers, type Question } from '../config/assessment';
import { loadAssessment, saveAssessment } from '../lib/assessmentStore';
import { track } from '../lib/analytics';
import { emitLifecycle } from '../lib/lifecycle';
import { useFunnel } from '../state/FunnelContext';

const fmt = (v: string) => {
  const digits = v.replace(/[^\d]/g, '').slice(0, 7);
  return digits ? Number(digits).toLocaleString('en-US') : '';
};

export default function Assessment() {
  const navigate = useNavigate();
  const { firstName } = useFunnel();
  const initial = useMemo(loadAssessment, []);
  const [answers, setAnswers] = useState<Answers>(initial.completedAt ? {} : initial.answers);
  const [index, setIndex] = useState(initial.completedAt ? 0 : initial.index);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const finished = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const qs = visibleQuestions(answers);
  const i = Math.min(index, qs.length - 1);
  const q: Question = qs[i];
  const isLast = i === qs.length - 1;
  const pct = Math.round((i / qs.length) * 100);

  useEffect(() => {
    if (initial.index === 0 && !Object.keys(initial.answers).length) {
      track('assessment_started');
      void emitLifecycle('assessment_started');
    }
    return () => {
      if (!finished.current) void emitLifecycle('assessment_incomplete');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync the currency draft when the question changes, and move focus to the new prompt
  useEffect(() => {
    if (q.kind === 'currency') setDraft(answers[q.id] ? fmt(String(answers[q.id])) : '');
    setError('');
    headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id]);

  function advance(next: Answers) {
    track('assessment_step_completed', { step: q.id });
    const nextQs = visibleQuestions(next);
    const pos = nextQs.findIndex((x) => x.id === q.id);
    if (pos >= nextQs.length - 1) {
      finished.current = true;
      saveAssessment({ answers: next, index: pos, completedAt: new Date().toISOString() });
      track('assessment_completed');
      void emitLifecycle('assessment_complete');
      navigate('/gameplan');
      return;
    }
    saveAssessment({ answers: next, index: pos + 1 });
    setIndex(pos + 1);
  }

  const choosing = useRef(false);
  function choose(value: string) {
    if (choosing.current) return; // ignore double taps while the next question loads
    choosing.current = true;
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    window.setTimeout(() => {
      advance(next);
      choosing.current = false;
    }, 220);
  }

  function submitCurrency(e: FormEvent) {
    e.preventDefault();
    const n = Number(draft.replace(/[^\d]/g, ''));
    if (!draft || Number.isNaN(n)) return setError('Enter an amount to continue. A rough number is fine.');
    if (q.min !== undefined && n < q.min) return setError(`Enter at least $${q.min.toLocaleString()}.`);
    if (q.max !== undefined && n > q.max) return setError('That looks higher than expected. Double-check the amount.');
    const next = { ...answers, [q.id]: n };
    setAnswers(next);
    advance(next);
  }

  function back() {
    if (i === 0) return navigate('/welcome');
    setIndex(i - 1);
    saveAssessment({ answers, index: i - 1 });
  }

  const sectionChanged = i === 0 || qs[i - 1]?.section !== q.section;

  return (
    <Layout chrome="customer">
      <Seo title="Your readiness assessment | RentReady" noindex />
      <div className="assess">
        <div className="assess-top">
          <div className="wrap wrap-narrow">
            <div className="assess-meta">
              <span>{q.section}</span>
              <span>
                Question {i + 1} of {qs.length}
              </span>
            </div>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Assessment progress">
              <span style={{ width: `${Math.max(pct, 3)}%` }} />
            </div>
          </div>
        </div>

        <div className="assess-body">
          <div className="wrap wrap-narrow q-enter" key={q.id}>
            {i === 0 && (
              <p className="lede muted" style={{ marginBottom: 20 }}>
                {firstName ? `Let’s start with the apartment you want, ${firstName}.` : 'Let’s start with the apartment you want.'} Your answers stay private and
                only shape your plan.
              </p>
            )}
            {sectionChanged && i !== 0 && <p className="q-section">{q.section}</p>}
            <h1 className="q-prompt" tabIndex={-1} ref={headingRef} id="q-h" style={{ outline: 'none' }}>
              {promptOf(q, answers)}
            </h1>
            {q.help && <p className="muted" style={{ marginTop: 10 }}>{q.help}</p>}

            {q.kind === 'choice' && (
              <div className="options" role="radiogroup" aria-labelledby="q-h">
                {q.options!.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={answers[q.id] === o.value}
                    className="option"
                    onClick={() => choose(o.value)}
                  >
                    <span className="radio" aria-hidden="true" />
                    {o.label}
                  </button>
                ))}
              </div>
            )}

            {q.kind === 'currency' && (
              <form onSubmit={submitCurrency} noValidate>
                <div className="money-input">
                  <span aria-hidden="true">$</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-labelledby="q-h"
                    aria-invalid={!!error}
                    aria-describedby={error ? 'q-err' : undefined}
                    value={draft}
                    onChange={(e) => setDraft(fmt(e.target.value))}
                    placeholder="0"
                    autoFocus
                  />
                </div>
                {error && <p id="q-err" className="field-error" style={{ marginTop: 10 }}><Icon name="alert" width={16} height={16} />{error}</p>}
                <div className="assess-nav">
                  <button type="button" className="text-link" onClick={back}>Back</button>
                  <button className="btn" type="submit">{isLast ? 'Build my game plan' : 'Continue'}</button>
                </div>
              </form>
            )}

            {q.kind === 'choice' && (
              <div className="assess-nav">
                <button type="button" className="text-link" onClick={back}>Back</button>
                <Link to="/access" className="text-link muted" style={{ fontSize: '0.92rem' }}>Save and finish later</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
