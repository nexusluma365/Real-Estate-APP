import { useEffect } from 'react';
import { CHECK_URL, INTENT_KEYS, INTENT_LABELS, INTENT_PAGES } from './intents';
import './page.css';

const INTENT_KEY = 'rrn_entry_intent_v1';
const TRACK_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

function writeIntent(value) {
  if (!INTENT_KEYS.includes(value)) return;
  try { sessionStorage.setItem(INTENT_KEY, value); } catch (_e) {}
  try { localStorage.setItem(INTENT_KEY, value); } catch (_e) {}
}

function marketingContext(intentKey, route) {
  const params = new URLSearchParams(window.location.search || '');
  return TRACK_KEYS.reduce((memo, key) => {
    memo[key] = params.get(key) || '';
    return memo;
  }, { entry_intent: intentKey, landing_page: route });
}

function rrTrack(eventName, detail = {}) {
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: eventName, ...detail });
    window.dispatchEvent(new CustomEvent('rentready:event', { detail: { event: eventName, ...detail } }));
  } catch (_e) {}
}

function setMeta(name, content) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
  return el;
}

function setCanonical(route) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', `${window.location.origin}${route}`);
  return el;
}

export default function IntentLanding({ intentKey }) {
  const page = INTENT_PAGES[intentKey] || INTENT_PAGES.approval_requirements;

  useEffect(() => {
    document.title = page.title;
    const meta = setMeta('description', page.description);
    const canonical = setCanonical(page.route);
    writeIntent(intentKey);
    rrTrack('intent_landing_view', marketingContext(intentKey, page.route));
    return () => {
      if (meta && meta.parentNode) meta.parentNode.removeChild(meta);
      if (canonical && canonical.parentNode) canonical.parentNode.removeChild(canonical);
    };
  }, [intentKey, page]);

  const onCta = () => {
    writeIntent(intentKey);
    rrTrack('intent_cta_click', marketingContext(intentKey, page.route));
  };

  return (
    <main className="intent-page">
      <nav className="intent-nav" aria-label="RentReady">
        <a className="intent-brand" href="/">
          <span className="intent-brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v9a1 1 0 0 0 1 1H9v-6h6v6h2.5a1 1 0 0 0 1-1v-9" /></svg>
          </span>
          <span>RentReady Network</span>
        </a>
      </nav>

      <section className="intent-hero">
        <p className="intent-eyebrow">{page.eyebrow}</p>
        <h1>{page.h1}</h1>
        <p className="intent-subhead">{page.subhead}</p>
        {page.body && <p className="intent-body">{page.body}</p>}
        <a className="intent-primary" href={CHECK_URL} onClick={onCta}>{page.primaryCta}</a>
        <div className="intent-trust" aria-label="RentReady trust points">
          <span>No Credit Pull</span>
          <span>Takes Just a Few Minutes</span>
          <span>Based on What You Tell Us</span>
        </div>
      </section>

      <section className="intent-section split">
        <div>
          <p className="intent-eyebrow">WHAT THIS MEANS</p>
          <h2>{page.sectionH2}</h2>
        </div>
        <div className="copy-stack">{page.sectionBody.map((text) => <p key={text}>{text}</p>)}</div>
      </section>

      <section className="intent-section checks">
        <div className="intent-section-head">
          <p className="intent-eyebrow">WHAT RENTREADY CHECKS</p>
          <h2>{page.secondH2}</h2>
        </div>
        <div className="bullet-grid">{page.bullets.map((item) => <div key={item} className="bullet-item"><span>✓</span>{item}</div>)}</div>
      </section>

      <section className="intent-section split">
        <div>
          <p className="intent-eyebrow">BEFORE YOU APPLY</p>
          <h2>Not Sure Which Situation Fits You?</h2>
        </div>
        <div className="copy-stack">
          <p>Start with the RentReady check and we'll help you organize the information you provide.</p>
          <a className="intent-secondary" href={CHECK_URL} onClick={onCta}>CHECK WHERE I STAND</a>
        </div>
      </section>

      <section className="intent-section faq-section">
        <div className="intent-section-head">
          <p className="intent-eyebrow">FAQ</p>
          <h2>Common Rental Questions</h2>
        </div>
        <div className="faq-list">
          {page.faq.map(([q, a]) => <article key={q}><h3>{q}</h3><p>{a}</p></article>)}
        </div>
      </section>

      <section className="intent-more" aria-label="Explore More Rental Questions">
        <h2>Explore More Rental Questions</h2>
        <div>
          {page.related.map((key) => {
            const relatedKey = key === 'first_apartment_no_credit' ? 'no_credit' : key;
            const related = INTENT_PAGES[relatedKey];
            return <a key={key} href={related.route}>{INTENT_LABELS[relatedKey]}</a>;
          })}
        </div>
      </section>

      <section className="intent-final">
        <h2>{page.finalHeadline}</h2>
        <a className="intent-primary" href={CHECK_URL} onClick={onCta}>{page.finalCta}</a>
        <p>RentReady provides rental-readiness guidance. Final approval and rental requirements are determined by each property.</p>
      </section>
    </main>
  );
}
