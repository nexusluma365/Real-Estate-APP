import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Icon, type IconName } from './Icon';
import { BookVisual } from './BookVisual';
import { CtaLink } from './ui';
import { LeadForm } from './LeadForm';
import { useLocation, useNavigate } from 'react-router-dom';
import bundleWebp from '../assets/rentready-digital-bundle.webp';
import bundleWebpSm from '../assets/rentready-digital-bundle-768.webp';
import bundlePng from '../assets/rentready-digital-bundle.png';
import { OPTION_COPY, PRODUCTS, dollars } from '../config/products';
import { QUAL_QUESTIONS, explain, intentTier, recommend, type QualAnswers, type Recommendation } from '../config/qualification';
import type { FaqItem } from '../config/faq';
import { env } from '../lib/env';
import { track } from '../lib/analytics';
import { emitLifecycle } from '../lib/lifecycle';
import { getQualification, saveQualification } from '../lib/qualification';
import { useFunnel } from '../state/FunnelContext';

export const CHECKOUT_TO = { guide: '/checkout?product=guide', creditready: '/checkout?product=creditready', checklist: '/checklist' } as const;
const GUARANTEE_DAYS = env.moneyBackDays;
const delay = (ms: number) => ({ ['--d' as string]: `${ms}ms` }) as CSSProperties;

/** True statements only — each one is enforced somewhere in this codebase. */
export function TrustBar() {
  const items: { icon: IconName; t: string }[] = [
    { icon: 'lock', t: 'Secure checkout by Stripe' },
    { icon: 'card', t: 'One-time payment, no subscription' },
    ...(GUARANTEE_DAYS > 0 ? [{ icon: 'shield' as IconName, t: `${GUARANTEE_DAYS}-day money-back guarantee` }] : []),
    { icon: 'home', t: 'Book ships to your door' },
    { icon: 'eye', t: 'We never pull your credit' },
  ];
  return (
    <div className="bk-trust" role="list" aria-label="Why it’s safe to buy">
      <div className="wrap bk-trust-row">
        {items.map((i) => (
          <span key={i.t} role="listitem"><Icon name={i.icon} />{i.t}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * The RentReady Digital Bundle mockup: transparent cutout (book, laptop, phone, letter box, tablet) that floats
 * on a soft gold glow with layered shadows, so it reads big and premium on any background.
 */
export function BundleImage({ className = '', sizes = '(min-width: 900px) 640px, 96vw', eager = false }: { className?: string; sizes?: string; eager?: boolean }) {
  return (
    <span className={`rr-bundle ${className}`}>
      <picture className="rr-bundle-img">
      <source srcSet={`${bundleWebpSm} 800w, ${bundleWebp} 1503w`} sizes={sizes} type="image/webp" />
      <img
        src={bundlePng}
        width={1503}
        height={999}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        alt="The RentReady Digital Bundle: the Before They Say No™ book, 20 Essential Credit Dispute Letter templates, and the step-by-step video guide on laptop, phone and tablet"
      />
      </picture>
    </span>
  );
}

/* ------------------------------------------------------------------ quiz */

const REC_LABEL: Record<Recommendation, string> = {
  creditready: 'The RentReady Digital Bundle',
  guide: 'Before They Say No™ — the book',
  checklist: 'The free Before-You-Apply Checklist',
};

/**
 * Three questions → a recommendation with a reason. Skippable at every step; never gates content.
 * The quiz result is the visitor's own — it is stored locally and only travels with a lead they submit.
 */
export function QualifyQuiz({ onResult }: { onResult: (r: Recommendation) => void }) {
  const { lead } = useFunnel();
  const [answers, setAnswers] = useState<QualAnswers>(() => getQualification());
  const done = !!(answers.stage && answers.concern && answers.help);
  const [step, setStep] = useState(() => (done ? QUAL_QUESTIONS.length : 0));
  const started = useRef(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const q = QUAL_QUESTIONS[step];

  useEffect(() => {
    if (done) onResult(recommend(answers).primary);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(v: string) {
    if (!started.current) {
      started.current = true;
      track('qualification_started');
    }
    const next = { ...answers, [q.id]: v } as QualAnswers;
    setAnswers(next);
    saveQualification(next);
    track('qualification_step', { step: q.id });
    if (step === QUAL_QUESTIONS.length - 1) {
      const rec = recommend(next);
      const tier = intentTier(next);
      track('qualification_completed', { intent_tier: tier, recommended: rec.primary });
      if (lead) void emitLifecycle('qualification_completed', { intent_tier: tier, recommended: rec.primary });
      onResult(rec.primary);
    }
    setStep(step + 1);
    requestAnimationFrame(() => headRef.current?.focus());
  }

  function restart() {
    setAnswers({});
    saveQualification({});
    setStep(0);
  }

  if (step >= QUAL_QUESTIONS.length) {
    const rec = recommend(answers);
    const why = explain(answers);
    const primary = rec.primary;
    return (
      <div className="bk-quiz-card bk-quiz-result" aria-live="polite">
        <span className="bk-quiz-kicker">Your best next step</span>
        <h3 ref={headRef} tabIndex={-1}>{REC_LABEL[primary]}</h3>
        <div className="bk-quiz-rec">
          <div className="bk-quiz-art">{primary === 'creditready' ? <BundleImage /> : <BookVisual size="thumb" />}</div>
          <div>
            {why && <p>{why}</p>}
            {primary === 'checklist' ? (
              <p>Start with the free checklist — the questions to ask before you pay an application fee and the documents to gather. When you want the full picture, the book is there.</p>
            ) : (
              <p className="bk-quiz-price">
                {primary === 'guide' ? 'Physical book, shipped to you.' : 'Physical book ships; digital tools unlock after checkout.'}
              </p>
            )}
          </div>
        </div>
        <div className="bk-quiz-actions">
          <CtaLink to={CHECKOUT_TO[primary]} className="btn bk-btn" props={{ cta_location: 'quiz_result', product: primary === 'checklist' ? undefined : primary, recommended: primary }}>
            {primary === 'checklist' ? 'Get the free checklist' : primary === 'guide' ? 'Get the Book' : 'Get the Digital Bundle'} <span className="bk-arrow" aria-hidden="true">→</span>
          </CtaLink>
          <a className="bk-link" href="#options" onClick={() => track('primary_cta_click', { cta_location: 'quiz_compare' })}>See the special offer</a>
        </div>
        <button type="button" className="bk-quiz-restart" onClick={restart}>Start over</button>
      </div>
    );
  }

  return (
    <div className="bk-quiz-card">
      <div className="bk-quiz-top">
        <span className="bk-quiz-kicker">Question {step + 1} of {QUAL_QUESTIONS.length}</span>
        <div className="bk-quiz-bar" aria-hidden="true"><span style={{ width: `${(step / QUAL_QUESTIONS.length) * 100}%` }} /></div>
      </div>
      <h3 ref={headRef} tabIndex={-1} id={`quiz-${q.id}`}>{q.q}</h3>
      <div className="bk-quiz-opts" role="group" aria-labelledby={`quiz-${q.id}`}>
        {q.options.map((o, i) => (
          <button key={o.v} type="button" className={`bk-quiz-opt${answers[q.id] === o.v ? ' on' : ''}`} onClick={() => pick(o.v)} style={delay(40 * i)}>
            {o.label}
            <span aria-hidden="true">→</span>
          </button>
        ))}
      </div>
      <div className="bk-quiz-foot">
        {step > 0 ? <button type="button" className="bk-quiz-restart" onClick={() => setStep(step - 1)}>← Back</button> : <span />}
        <a className="bk-quiz-skip" href="#options" onClick={() => track('qualification_skipped', { step: q.id })}>Skip — show me the special offer</a>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ options */

/**
 * The special-offer section: one Complete Bundle card, no price on the page (the price is shown at checkout,
 * before payment). No deadline or countdown — there isn't a real one, so none is implied.
 */
export function Options({ recommended }: { recommended?: Recommendation }) {
  const ref = useRef<HTMLDivElement>(null);
  const P = PRODUCTS.creditready;
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      track('options_view', { recommended, variant: 'special_offer' });
      track('product_view', { product: 'creditready', order_value: dollars(P.priceCents) });
      io.disconnect();
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref}>
      <article className="bk-opt bk-opt-featured bk-opt-solo" data-reveal aria-labelledby="opt-bundle">
        <div className="bk-opt-art"><BundleImage sizes="(min-width: 900px) 860px, 100vw" /></div>
        <span className="bk-opt-badge">Special offer</span>
        <h3 id="opt-bundle">The Complete RentReady Bundle</h3>
        <p className="bk-opt-sub">Everything you need to prepare — together, in one bundle.</p>
        <ul>
          {P.includes.map((t) => <li key={t}><Icon name="check" />{t}</li>)}
        </ul>
        <p className="bk-opt-delivery"><Icon name="home" />{OPTION_COPY.creditready.delivery}</p>
        <CtaLink to={CHECKOUT_TO.creditready} className="btn bk-btn" props={{ cta_location: 'special_offer', product: 'creditready', recommended }}>
          Get the Complete Bundle <span className="bk-arrow" aria-hidden="true">→</span>
        </CtaLink>
        <ul className="bk-solo-assure" aria-label="Purchase protection">
          <li><Icon name="lock" />Secure checkout</li>
          <li><Icon name="card" />One-time purchase</li>
          {GUARANTEE_DAYS > 0 && <li><Icon name="shield" />{GUARANTEE_DAYS}-day money-back guarantee</li>}
        </ul>
      </article>
    </div>
  );
}

/* ------------------------------------------------------------------ objections */

export function BuyFaqList({ items }: { items: FaqItem[] }) {
  return (
    <div className="bk-faq">
      {items.map((f) => (
        <details key={f.id} id={`faq-${f.id}`} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && track('faq_open', { step: f.id })}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ free-book offer */

const EXIT_DELAY = 1000 * 30;
/** The offer's destination, checkout and everything after purchase never show it. */
const EXIT_HIDDEN = ['/creditready', '/checkout', '/complete-your-system', '/welcome', '/assessment', '/gameplan', '/access', '/admin', '/account', '/premium'];

/**
 * Mounted once for the whole app. Opens after 30 seconds on a pre-purchase page, once per page load: every refresh,
 * new tab or return visit starts a new session; moving between pages inside the site doesn't. Never for customers. Esc / backdrop / buttons close it. The email goes on to the Digital Bundle page, where the
 * free physical book and the Bundle's full price are both shown before anyone buys.
 */
export function ExitOffer() {
  const { entitlements } = useFunnel();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const shown = useRef(false);
  const allowed = !EXIT_HIDDEN.some((p) => pathname.startsWith(p));
  // An unreachable API ('error') still means "no known purchase", so the offer can show.
  const eligible = allowed && entitlements.status !== 'loading' && entitlements.products.length === 0;

  useEffect(() => {
    if (!eligible) return;
    if (shown.current) return;
    const timer = window.setTimeout(() => {
      shown.current = true;
      setOpen(true);
      track('exit_offer_shown', { method: 'timer_30s' });
    }, EXIT_DELAY);
    return () => window.clearTimeout(timer);
  }, [eligible]);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!open || !allowed) return null;
  return (
    <div className="bk-exit" onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="bk-exit-card" role="dialog" aria-modal="true" aria-labelledby="exit-h" aria-describedby="exit-d">
        <button ref={closeRef} type="button" className="bk-exit-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
        <BookVisual size="thumb" eager className="bk-exit-book" />
        <h2 id="exit-h" className="bk-exit-h">GET THIS BOOK FOR FREE</h2>
        <p id="exit-d" className="bk-exit-sub">
          Your physical copy of <strong>Before They Say No™</strong> is included free with the RentReady Digital Bundle,
          along with 20 editable dispute letters and the step-by-step video guide.
        </p>
        <LeadForm
          source="exit"
          submitLabel="Claim My Free Book →"
          productInterest="creditready"
          optIn={false}
          requireFirstName={false}
          emailConsentValue={false}
          consentText="Email entered to continue to the RentReady Digital Bundle offer. No promotional email consent was given."
          helpText="Enter your email to see the Bundle with your free book."
          finePrint="The book is free with the paid Digital Bundle; you'll see the full Bundle price before you buy. No credit pull, and we never sell your email."
          onDone={() => {
            track('exit_offer_click', { cta_location: 'exit', product: 'creditready' });
            setOpen(false);
            navigate('/creditready?source=exit_offer');
          }}
        />
        <button type="button" className="bk-quiz-restart bk-exit-skip" onClick={() => setOpen(false)}>No thanks, keep reading</button>
      </div>
    </div>
  );
}
