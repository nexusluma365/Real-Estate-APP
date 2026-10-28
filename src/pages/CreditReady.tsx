import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { Checklist, CtaLink, Faq, Journey, StickyCta, useOnce } from '../components/ui';
import { BundleImage } from '../components/Funnel';
import { Icon } from '../components/Icon';
import { ComplianceBlock, Testimonials } from '../components/Content';
import { BUNDLE_PARTS, dollars, PRODUCTS } from '../config/products';
import { buyFaq, OBJECTIONS } from '../config/faq';
import { SITE } from '../config/site';
import { env } from '../lib/env';
import { track } from '../lib/analytics';

const P = PRODUCTS.creditready;
const CTA = `Get the Digital Bundle — ${P.priceLabel}`;
const TO = '/checkout?product=creditready';
const FAQ = [
  ...buyFaq({ guidePrice: PRODUCTS.guide.priceLabel, bundlePrice: P.priceLabel, upgradePrice: PRODUCTS.upgrade.priceLabel, refundDays: env.moneyBackDays, deliveryNote: env.physicalDeliveryNote, supportEmail: SITE.supportEmail })
    .filter((f) => ['which-one', 'applying-soon', 'physical', 'refund', 'subscription'].includes(f.id)),
  ...OBJECTIONS,
];
const cta = (loc: string) => ({ event: 'credit_offer_cta' as const, props: { cta_location: loc, product: 'creditready' as const } });

export default function CreditReady() {
  useOnce(() => {
    track('credit_offer_view', { product: 'creditready' });
    track('product_view', { product: 'creditready', order_value: dollars(P.priceCents) });
  });
  return (
    <Layout>
      <Seo title={`${P.name} — ${P.priceLabel} one time | RentReady`} description={P.promise} />

      <section className="hero" aria-labelledby="cr-h">
        <div className="wrap">
          <div>
            <Journey at={2} />
            <span className="wordmark-eyebrow">THE RENTREADY DIGITAL BUNDLE</span>
            <h1 id="cr-h">Start with the part you can work on.</h1>
            <p className="lede">
              Before They Say No™ shows you what a property may see. 20 ready-to-edit dispute letters and a step-by-step
              video guide help you act on it — before your next rental application.
            </p>
            <p className="muted" style={{ color: 'var(--muted-on-ink)' }}>
              The physical book is included at no additional charge with your Digital Bundle purchase. The Bundle is a paid
              offer, and its full price is shown before checkout. The toolkit helps you review and dispute information you
              believe is inaccurate; removals are not guaranteed.
            </p>
            <div className="cta-row">
              <CtaLink to={TO} {...cta('hero')}>{CTA}</CtaLink>
              <span className="muted" style={{ color: 'var(--muted-on-ink)' }}>
                One time. No subscription.{env.moneyBackDays > 0 && ` ${env.moneyBackDays}-day money-back guarantee.`}
              </span>
            </div>
          </div>
          <div className="cr-hero-art"><BundleImage eager /></div>
        </div>
        <span id="cr-hero-end" />
      </section>

      <section className="band band-paper" aria-labelledby="q-h">
        <div className="wrap">
          <h2 id="q-h" className="measure">Before you apply, you should be able to answer three questions.</h2>
          <ul className="quote-list">
            <li>What’s actually on my credit reports — all three of them?</li>
            <li>Is any of it inaccurate, incomplete, or not mine?</li>
            <li>What will I do about each item before my application date?</li>
          </ul>
          <p className="lede muted" style={{ marginTop: 28 }}>The Digital Bundle is built to get you to clear answers — and give you the letters to act on them.</p>
        </div>
      </section>

      <section className="band band-ink" aria-labelledby="mod-h">
        <div className="wrap">
          <h2 id="mod-h" className="measure">Three parts. One plan before you apply.</h2>
          <ol className="modules two-col">
            {BUNDLE_PARTS.map((m) => (
              <li key={m.title}>
                <div>
                  <h3>{m.title}</h3>
                  <p>{m.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="band" aria-labelledby="inc-h">
        <div className="wrap grid-2">
          <div className="stack">
            <h2 id="inc-h">Everything in the Digital Bundle.</h2>
            <Checklist items={P.includes} />
            <p className="muted">The letters and video guide unlock on your access page right after checkout. The book ships to you.</p>
          </div>
          <BundleImage />
        </div>
      </section>

      <section className="band band-paper band-rule" aria-labelledby="rent-h">
        <div className="wrap grid-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <h2 id="rent-h">Built for renters, not for “credit repair.”</h2>
            <p className="lede">Most credit material is written for mortgages and car loans. This is written for your next lease.</p>
          </div>
          <div className="stack">
            <p>
              That means focusing on what can matter when you apply for an apartment: collections tied to prior rentals
              and utilities, how long disputes commonly take compared to your move date, and what to be ready to explain
              if something accurate is on your report.
            </p>
            <p className="muted">
              You do the work yourself, with clear steps. Nothing is sent on your behalf, and nothing is promised that a
              book, a set of letters and a video guide can’t deliver.
            </p>
          </div>
        </div>
      </section>

      <Testimonials />

      <section className="band" aria-labelledby="price-h">
        <div className="wrap" style={{ maxWidth: 640 }}>
          <div className="price-card">
            <h2 id="price-h" style={{ fontSize: 'var(--step-3)' }}>{P.name}</h2>
            <div className="price-line">
              <span className="price">{P.priceLabel}</span>
              <span className="price-meta">one time</span>
            </div>
            <p className="muted">No subscription. No monthly fees. Letters and videos unlock instantly; your book ships.</p>
            <div style={{ margin: '24px 0' }}>
              <Checklist items={P.includes.slice(0, 4)} />
            </div>
            <CtaLink to={TO} className="btn btn-block" {...cta('price_card')}>{CTA}</CtaLink>
            {env.moneyBackDays > 0 && (
              <p className="fine" style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="shield" width={16} height={16} /> {env.moneyBackDays}-day money-back guarantee
              </p>
            )}
            <p className="fine" style={{ marginTop: 10, textAlign: 'center' }}>
              Just want the book? <CtaLink to="/checkout?product=guide" className="text-link" props={{ cta_location: 'price_card_guide', product: 'guide' }}>Get Before They Say No™ — {PRODUCTS.guide.priceLabel}</CtaLink>. Your purchase counts in full if you upgrade later.
            </p>
            <p className="fine" style={{ marginTop: 14 }}>
              Educational resource. Does not guarantee apartment approval, credit score changes or removal of any information.
            </p>
          </div>
        </div>
      </section>

      <section className="band band-paper band-rule" aria-labelledby="obj-h">
        <div className="wrap wrap-narrow">
          <h2 id="obj-h">Fair questions, straight answers</h2>
          <Faq items={FAQ} idPrefix="obj" />
          <div className="cta-row" style={{ marginTop: 40 }}>
            <CtaLink to={TO} {...cta('after_faq')}>{CTA}</CtaLink>
          </div>
        </div>
      </section>

      <ComplianceBlock />
      <StickyCta to={TO} label={CTA} sentinelId="cr-hero-end" event="credit_offer_cta" props={{ product: 'creditready' }} meta="One time, no subscription" />
    </Layout>
  );
}
