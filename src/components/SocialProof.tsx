import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon } from './Icon';
import { CtaLink } from './ui';
import { CONCERNS, publishedTestimonials, type Testimonial } from '../config/testimonials';

/**
 * Home page social proof: one card at a time in an auto-rotating carousel.
 * Real testimonials appear only once they're verified, consented and switched on (src/config/testimonials.ts).
 * Until then the same carousel shows common renter concerns — clearly labeled, with no names, photos or ratings.
 */
export function SocialProof() {
  const real = publishedTestimonials();
  const slides = real.length
    ? real.map((t) => ({ key: t.id, node: <TestimonialCard t={t} /> }))
    : CONCERNS.map((c) => ({ key: c.id, node: <ConcernCard {...c} /> }));
  return (
    <section className="bk-sec bk-white tc-sec" id="stories" aria-labelledby="stories-h">
      <div className="wrap">
        <div className="bk-head center" data-reveal>
          <span className="tc-eyebrow">{real.length ? 'Real people. Real experiences.' : 'Common concerns. Real answers.'}</span>
          <h2 id="stories-h" className="bk-h2">{real.length ? 'They Had Doubts, Too.' : 'You’re Not the Only One With Doubts.'}</h2>
          <p className="bk-body">
            {real.length
              ? 'Bad credit. Past denials. Not knowing where to start. See how renters like you found the information and confidence to take their next step.'
              : 'Bad credit. Past denials. Not knowing where to start. These are the worries renters bring to RentReady — and how it helps you prepare before you apply.'}
          </p>
        </div>
        <div data-reveal>
          <Carousel label={real.length ? 'Customer stories' : 'Common renter concerns'} slides={slides} />
          {!real.length && <p className="tc-note">Common renter concerns — not customer reviews.</p>}
        </div>
        <div className="tc-cta" data-reveal>
          <h3>Your Next Chapter Could Start Here.</h3>
          <p>You don’t have to figure everything out alone. Learn what property managers may look for and discover ways to prepare for your next application.</p>
          <CtaLink to="/find-my-apartment" className="btn bk-btn" props={{ cta_location: 'social_proof' }}>
            Explore Your Options <span className="bk-arrow" aria-hidden="true">→</span>
          </CtaLink>
        </div>
      </div>
    </section>
  );
}

function TestimonialCard({ t }: { t: Testimonial }) {
  const initials = t.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <article className="tc-card">
      <div className="tc-avatar">
        {t.photo ? <img src={t.photo} alt="" width={96} height={96} loading="lazy" decoding="async" /> : <span aria-hidden="true">{initials}</span>}
      </div>
      {t.rating && (
        <p className="tc-stars" aria-label={`${t.rating} out of 5 stars`}>
          {Array.from({ length: 5 }, (_, i) => <span key={i} aria-hidden="true" className={i < t.rating! ? 'on' : ''}>★</span>)}
        </p>
      )}
      <h3 className="tc-headline">“{t.headline}”</h3>
      <p className="tc-quote">{t.quote}</p>
      <p className="tc-name">— {t.name}{t.context ? `, ${t.context}` : ''}</p>
      {t.disclosure && <p className="tc-disclosure">{t.disclosure}</p>}
    </article>
  );
}

function ConcernCard({ icon, worry, help }: (typeof CONCERNS)[number]) {
  return (
    <article className="tc-card">
      <div className="tc-avatar tc-avatar-icon"><Icon name={icon} /></div>
      <p className="tc-kicker">A common concern</p>
      <h3 className="tc-headline">{worry}</h3>
      <p className="tc-quote"><strong>How RentReady helps:</strong> {help}</p>
    </article>
  );
}

// ------------------------------------------------------------------------------------------------ carousel
const SWIPE_PX = 50;
const SLIDE_MS = 600;

const prefersReduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * One slide at a time, sliding right to left and looping seamlessly (a copy of the first slide sits after the last).
 * Advances every `interval` ms; pauses on hover, keyboard focus, a hidden tab or when scrolled out of view.
 * Swipe on touch screens; dots and previous/next buttons below. Reduced motion: no auto-rotation, no sliding.
 */
export function Carousel({ label, slides, interval = 3000 }: { label: string; slides: { key: string; node: ReactNode }[]; interval?: number }) {
  const n = slides.length;
  const [reduced, setReduced] = useState(prefersReduced);
  // Position in [last copy, ...slides, first copy]; 1 is the first real slide.
  const [pos, setPos] = useState(1);
  const [animate, setAnimate] = useState(true);
  const [drag, setDrag] = useState(0);
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const moving = useRef(false);
  const settleTimer = useRef<number>();
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const active = (((pos - 1) % n) + n) % n;
  const posRef = useRef(pos);
  posRef.current = pos;

  // From a copy at either end, jump (without animating) to the real slide it shows.
  const settle = useCallback(() => {
    window.clearTimeout(settleTimer.current);
    moving.current = false;
    const p = posRef.current;
    if (p > n || p < 1) {
      setAnimate(false);
      setPos(p > n ? 1 : n);
    }
  }, [n]);

  useEffect(() => {
    if (animate) return;
    // Two frames later the jump has painted; slide normally again.
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setAnimate(true)); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [animate]);

  const go = useCallback((to: number) => {
    if (n < 2 || moving.current) return;
    if (reduced) return setPos(1 + ((((to - 1) % n) + n) % n));
    moving.current = true;
    setAnimate(true);
    setPos(to);
    // If transitionend never arrives (e.g. the tab was hidden mid-slide), finish anyway.
    settleTimer.current = window.setTimeout(settle, SLIDE_MS + 150);
  }, [n, reduced, settle]);

  // Auto-advance. Depends on pos, so any manual move restarts the full interval.
  const paused = hover || focused || hidden || offscreen || reduced || drag !== 0;
  useEffect(() => {
    if (n < 2 || paused) return;
    const t = window.setTimeout(() => go(pos + 1), interval);
    return () => window.clearTimeout(t);
  }, [pos, paused, interval, n, go]);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMq = () => setReduced(!!mq?.matches);
    const onVis = () => setHidden(document.visibilityState === 'hidden');
    mq?.addEventListener?.('change', onMq);
    document.addEventListener('visibilitychange', onVis);
    let io: IntersectionObserver | undefined;
    if (root.current && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(([e]) => setOffscreen(!e.isIntersecting), { threshold: 0.25 });
      io.observe(root.current);
    }
    return () => {
      mq?.removeEventListener?.('change', onMq);
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
      window.clearTimeout(settleTimer.current);
    };
  }, []);

  // Touch / pen swipe. Vertical scrolling still works (touch-action: pan-y on the viewport).
  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' || n < 2 || moving.current) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  }
  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    if (!drag && Math.abs(e.clientY - s.y) > Math.abs(dx)) { start.current = null; return; }
    if (Math.abs(dx) > 4) {
      if (!drag) e.currentTarget.setPointerCapture?.(e.pointerId);
      setAnimate(false);
      setDrag(dx);
    }
  }
  function onUp() {
    if (!start.current) return;
    start.current = null;
    const dx = drag;
    setDrag(0);
    setAnimate(true);
    if (dx <= -SWIPE_PX) go(pos + 1);
    else if (dx >= SWIPE_PX) go(pos - 1);
  }

  if (!n) return null;
  const ext = n > 1 ? [slides[n - 1], ...slides, slides[0]] : slides;
  const offset = n > 1 ? pos : 0;

  return (
    <div
      ref={root}
      className="tc"
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setFocused(false)}
    >
      <div className="tc-viewport" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div
          className="tc-track"
          aria-live={paused ? 'polite' : 'off'}
          style={{
            transform: `translate3d(calc(${-offset * 100}% + ${drag}px), 0, 0)`,
            transition: animate && !reduced ? `transform ${SLIDE_MS}ms cubic-bezier(.22, .8, .24, 1)` : 'none',
          }}
          onTransitionEnd={(e) => e.target === e.currentTarget && e.propertyName === 'transform' && settle()}
        >
          {ext.map((s, i) => {
            const real = n > 1 ? i >= 1 && i <= n : true;
            const index = n > 1 ? i - 1 : i;
            const shown = real && index === active;
            return (
              <div
                key={`${s.key}-${i}`}
                className={`tc-slide${i === offset ? ' is-active' : ''}`}
                role={real ? 'group' : undefined}
                aria-roledescription={real ? 'slide' : undefined}
                aria-label={real ? `${index + 1} of ${n}` : undefined}
                aria-hidden={!shown}
              >
                {s.node}
              </div>
            );
          })}
        </div>
      </div>
      {n > 1 && (
        <div className="tc-nav">
          <button type="button" className="tc-arrow" onClick={() => go(pos - 1)} aria-label="Previous">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="tc-dots">
            {slides.map((s, i) => (
              <button
                key={s.key}
                type="button"
                className={`tc-dot${i === active ? ' on' : ''}`}
                aria-label={`Show ${i + 1} of ${n}`}
                aria-current={i === active ? 'true' : undefined}
                onClick={() => go(i + 1)}
              />
            ))}
          </div>
          <button type="button" className="tc-arrow" onClick={() => go(pos + 1)} aria-label="Next">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
      )}
    </div>
  );
}
