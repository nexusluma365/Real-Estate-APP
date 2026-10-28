import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { track, type EventProps, type FunnelEvent } from '../lib/analytics';
import type { Rating } from '../lib/types';
import { RATING_LABEL } from '../lib/gameplan';
import type { FaqItem } from '../config/faq';

export function CtaLink({
  to,
  children,
  event = 'primary_cta_click',
  props,
  className = 'btn',
}: {
  to: string;
  children: ReactNode;
  event?: FunnelEvent;
  props?: EventProps;
  className?: string;
}) {
  return (
    <Link to={to} className={className} onClick={() => track(event, props)}>
      {children}
    </Link>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

export function Tag({ rating }: { rating: Rating }) {
  return (
    <span className={`tag tag-${rating}`}>
      <span className="tag-dot" aria-hidden="true" />
      {RATING_LABEL[rating]}
    </span>
  );
}

export function Faq({ items, idPrefix = 'faq' }: { items: FaqItem[]; idPrefix?: string }) {
  return (
    <div className="faq">
      {items.map((f) => (
        <details key={f.id} id={`${idPrefix}-${f.id}`}>
          <summary>{f.q}</summary>
          <div className="answer">
            <p>{f.a}</p>
          </div>
        </details>
      ))}
    </div>
  );
}

export function TrustList({ items }: { items: string[] }) {
  return (
    <ul className="trust-list">
      {items.map((t) => (
        <li key={t}>
          <Icon name="check" />
          {t}
        </li>
      ))}
    </ul>
  );
}

export function Checklist({ items }: { items: readonly string[] }) {
  return (
    <ul className="checklist">
      {items.map((t) => (
        <li key={t}>
          <Icon name="check" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}

const STEPS = ['Start', 'Learn', 'Choose', 'Checkout'] as const;
export function Journey({ at }: { at: number }) {
  return (
    <ol className="journey" aria-label="Your progress">
      {STEPS.map((s, i) => (
        <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>
          {i < at && <Icon name="check" width={14} height={14} />}
          {s}
        </li>
      ))}
    </ol>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'info' | 'ok'; children: ReactNode }) {
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon name={kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info'} />
      <div>{children}</div>
    </div>
  );
}

/** Shows after the hero scrolls out of view. Mobile only (CSS). */
export function StickyCta({ to, label, meta, sentinelId, props, event }: { to: string; label: string; meta?: string; sentinelId: string; props?: EventProps; event?: FunnelEvent }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const el = document.getElementById(sentinelId);
      if (el) setShow(el.getBoundingClientRect().top < 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sentinelId]);
  return (
    <div className={`sticky-cta${show ? ' show' : ''}`} aria-hidden={!show}>
      {meta && <span className="sticky-meta">{meta}</span>}
      <CtaLink to={to} event={event} props={{ cta_location: 'sticky', ...props }} className="btn">
        {label}
      </CtaLink>
    </div>
  );
}

export function useOnce(fn: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function Loader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}
