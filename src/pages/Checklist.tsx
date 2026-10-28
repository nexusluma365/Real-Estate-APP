import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { BookVisual } from '../components/BookVisual';
import { LeadForm } from '../components/LeadForm';
import { Alert, CtaLink, useOnce } from '../components/ui';
import { Icon } from '../components/Icon';
import { PRODUCTS } from '../config/products';
import { captureAttribution } from '../lib/attribution';
import { track } from '../lib/analytics';
import { emitLifecycle } from '../lib/lifecycle';

/**
 * Free lead magnet for early-stage visitors. The whole checklist is readable without an email —
 * the optional form only emails a copy and opts in to follow-up (explicit checkbox).
 * Content restates general guidance already on the site; nothing here is property- or person-specific.
 */
const ASK = [
  'Can I see your written screening criteria before I apply?',
  'Do you run a hard or soft credit check, and which screening company do you use?',
  'What is the income requirement — and is it based on gross or take-home pay?',
  'Can co-applicants combine income? Do you accept a guarantor?',
  'Is there a minimum credit score? Is there conditional approval, such as a larger deposit?',
  'How do you treat collections, medical debt or a past rental balance?',
  'How far back do you look at rental and eviction history?',
  'Is the application fee refundable, and how long does a decision usually take?',
];
const CHECK = [
  'Get your free credit reports from all three bureaus at AnnualCreditReport.com.',
  'Mark anything you don’t recognize, or with a wrong balance, date or status.',
  'Separate errors (worth disputing) from accurate items (worth being ready to explain).',
  'Denied before? Use the adverse action notice to request the screening report it names.',
  'Write a short, factual explanation for anything accurate that may come up.',
];
const DOCS = [
  'Government-issued photo ID',
  'Recent pay stubs or an offer letter',
  'Recent bank statements',
  'Tax returns or 1099s if you’re self-employed',
  'Contact details for current and previous landlords',
  'Any reference letters you can get',
];

export default function Checklist() {
  const { search, pathname } = useLocation();
  const [sent, setSent] = useState(false);
  useOnce(() => {
    captureAttribution(search, pathname);
    track('free_resource_view', { resource: 'before_you_apply_checklist' });
  });

  const List = ({ items, n }: { items: string[]; n?: boolean }) => (
    <ul className="ck-list">
      {items.map((t, i) => (
        <li key={t}>
          <span className="ck-box" aria-hidden="true">{n ? i + 1 : <Icon name="check" />}</span>
          {t}
        </li>
      ))}
    </ul>
  );

  return (
    <Layout chrome="book">
      <Seo
        title="The Before-You-Apply Checklist — Free | RentReady"
        description="The questions to ask before you pay an apartment application fee, what to check on your own reports, and the documents to have ready."
      />
      <div className="bk">
        <section className="bk-hero ck-hero" aria-labelledby="ck-h">
          <div className="wrap">
            <p className="bk-ribbon">Free · no email required</p>
            <h1 id="ck-h" className="bk-title ck-title">The Before-You-Apply <span>Checklist.</span></h1>
            <p className="bk-hero-sub">Ask the right questions before you pay a fee. Check your side before they do.</p>
            <button type="button" className="btn bk-btn-outline ck-print" onClick={() => { track('product_download', { resource: 'checklist_print' }); window.print(); }}>
              <Icon name="download" width={18} height={18} /> Print or save as PDF
            </button>
          </div>
        </section>

        <section className="bk-sec bk-white">
          <div className="wrap ck-wrap">
            <div className="ck-block">
              <span className="bk-label">Part 1</span>
              <h2 className="bk-h2">Ask before you pay an application fee.</h2>
              <List items={ASK} n />
            </div>
            <div className="ck-block">
              <span className="bk-label">Part 2</span>
              <h2 className="bk-h2">Check your side first.</h2>
              <List items={CHECK} />
            </div>
            <div className="ck-block">
              <span className="bk-label">Part 3</span>
              <h2 className="bk-h2">Have these ready.</h2>
              <List items={DOCS} />
            </div>
            <p className="bk-fine">General education only. Every property sets its own requirements and makes its own decision.</p>
          </div>
        </section>

        <section className="bk-sec bk-ivory ck-noprint" aria-labelledby="ck-email-h">
          <div className="wrap ck-email">
            <div>
              <h2 id="ck-email-h" className="bk-h2">Want a copy in your inbox?</h2>
              <p className="bk-body">We’ll email the checklist so it’s there when you’re standing in a leasing office. Optional.</p>
            </div>
            <div className="bk-quiz-card ck-form">
              {sent ? (
                <Alert kind="ok">Done — check your inbox. You can read everything above anytime.</Alert>
              ) : (
                <LeadForm
                  source="checklist"
                  submitLabel="Email me the checklist"
                  optIn
                  optInLabel="Also send me a few short emails on preparing my application. Unsubscribe anytime."
                  helpText="We’ll send the checklist here."
                  onDone={() => {
                    setSent(true);
                    track('free_resource_requested', { resource: 'before_you_apply_checklist' });
                    void emitLifecycle('free_resource_requested', { resource: 'before_you_apply_checklist' });
                  }}
                />
              )}
            </div>
          </div>
        </section>

        <section className="bk-sec bk-dark bk-final ck-noprint" aria-labelledby="ck-next-h">
          <div className="wrap bk-final-grid">
            <div className="bk-final-book"><BookVisual size="feature" /></div>
            <div className="bk-final-copy">
              <h2 id="ck-next-h" className="bk-h2">The checklist tells you what to ask. <em>The book tells you why.</em></h2>
              <p className="bk-final-sub">
                Before They Say No™ explains what property managers may review, what may be hurting your chances, and how to
                prepare — before you apply.
              </p>
              <div className="bk-buy">
                <CtaLink to="/checkout?product=guide" className="btn bk-btn" props={{ cta_location: 'checklist', product: 'guide' }}>
                  Get the Book — {PRODUCTS.guide.priceLabel} <span className="bk-arrow" aria-hidden="true">→</span>
                </CtaLink>
                <p className="bk-buy-alt">
                  Or see the <CtaLink to="/#options" className="bk-link" props={{ cta_location: 'checklist_options' }}>Complete Bundle special offer</CtaLink> with dispute letters and a video guide.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
}
