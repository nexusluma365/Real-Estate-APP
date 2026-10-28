import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { CtaLink, useOnce } from '../components/ui';
import { Icon } from '../components/Icon';
import { DigitalKitDownload } from '../components/DigitalKitDownload';
import { BundleImage } from '../components/Funnel';
import { BUNDLE_TOTAL_CENTS, dollars, PRODUCTS } from '../config/products';
import { track } from '../lib/analytics';
import { loadAssessment } from '../lib/assessmentStore';
import { useFunnel } from '../state/FunnelContext';

/**
 * Post-purchase welcome for every buyer.
 * Digital Bundle (± Playbook): what you own → open the letters + video guide → bonus game plan.
 * Book only: it's shipping → one quiet, credited upgrade option to the Bundle (no pressure, no repeat).
 */
export default function Welcome() {
  const { owns, firstName, lead } = useFunnel();
  if (!owns('creditready')) return <GuideWelcome firstName={firstName} email={lead?.email} />;
  return <KitWelcome full={owns('playbook')} firstName={firstName} email={lead?.email} />;
}

function KitWelcome({ full, firstName, email }: { full: boolean; firstName: string; email?: string }) {
  const assessmentDone = !!loadAssessment().completedAt;
  useOnce(() => track('thankyou_view', { product: full ? 'bundle' : 'creditready', order_value: dollars(full ? BUNDLE_TOTAL_CENTS : PRODUCTS.creditready.priceCents) }));

  const items = full
    ? [
        { name: PRODUCTS.creditready.name, note: 'Your book is on its way; your letters and video guide are ready now', owned: true },
        { name: PRODUCTS.playbook.name, note: 'Rental screening, from the other side of the desk', owned: true },
        { name: 'Personalized RentReady Game Plan', note: 'Full plan with screening questions and documentation guidance', owned: true },
      ]
    : [
        { name: PRODUCTS.creditready.name, note: 'Your book is on its way; your letters and video guide are ready now', owned: true },
        { name: PRODUCTS.playbook.name, note: 'Not purchased — you can add it from your access page anytime', owned: false },
      ];

  return (
    <Layout chrome="customer">
      <Seo title={full ? 'Your RentReady system is unlocked' : 'Your Digital Bundle is ready'} noindex />
      <section className="celebrate">
        <div className="wrap wrap-narrow">
          <div className="seal"><Icon name="key" /></div>
          <h1 style={{ fontSize: 'var(--step-5)' }}>
            {full ? 'Your complete RentReady system is unlocked.' : 'Your Digital Bundle is ready.'}
          </h1>
          <p className="lede center" style={{ marginTop: 18, color: '#e3dccf' }}>
            {firstName ? `${firstName}, you` : 'You'} just did what most renters never do: prepared before applying.
            {email && <> Your receipt and access link are on their way to <strong>{email}</strong>.</>}
          </p>

          <div className="owned" aria-label="Your products">
            {items.map((i) => (
              <div key={i.name} className={`owned-item${i.owned ? '' : ' not'}`}>
                <span className="ic"><Icon name={i.owned ? 'check' : 'book'} /></span>
                <span>
                  <strong>{i.name}</strong>
                  <br />
                  <span className="muted" style={{ fontSize: '0.92rem', color: 'var(--muted-on-ink)' }}>{i.note}</span>
                </span>
                {i.owned && <span className="tag tag-strong">Yours</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="next-h">
        <div className="wrap grid-2">
          <div className="stack">
            <span className="kicker">Your next step</span>
            <h2 id="next-h">Start with the video guide.</h2>
            <p className="lede">It walks you through how to dispute negative items you believe are inaccurate, and how to use your 20 letter templates.</p>
            <p className="muted">
              Your letters are Microsoft Word files — fill in your details, print, and send them yourself. Your book ships to
              the address you entered.
            </p>
            <DigitalKitDownload ctaLocation="welcome" />
            <div className="cta-row">
              <CtaLink to="/access" props={{ cta_location: 'welcome_resources' }}>Open my videos and other resources</CtaLink>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              <strong>Bonus:</strong> a five-minute private assessment that turns your rent, income, credit and timing into a
              prioritized game plan. We don’t check your credit.{' '}
              {assessmentDone ? <Link to="/gameplan" className="text-link">View my game plan</Link> : <Link to="/assessment" className="text-link">Start my assessment</Link>}
            </p>
          </div>
          <div className="scenario" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 'var(--step-1)', marginBottom: 16 }}>What your plan covers</h3>
            <ul className="checklist">
              {['Income position', 'Credit position', 'Rental history', 'Reported concerns', 'Documentation to prepare', 'Questions to ask', 'Priority actions'].map((t) => (
                <li key={t}><Icon name="check" /><span>{t}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </Layout>
  );
}

function GuideWelcome({ firstName, email }: { firstName: string; email?: string }) {
  useOnce(() => {
    track('thankyou_view', { product: 'guide', order_value: dollars(PRODUCTS.guide.priceCents) });
    track('upgrade_offer_view', { product: 'upgrade', order_value: dollars(PRODUCTS.upgrade.priceCents) });
  });
  return (
    <Layout chrome="customer">
      <Seo title="Your book is ready" noindex />
      <section className="celebrate">
        <div className="wrap wrap-narrow">
          <div className="seal"><Icon name="home" /></div>
          <h1 style={{ fontSize: 'var(--step-5)' }}>Your copy of Before They Say No™ is on its way.</h1>
          <p className="lede center" style={{ marginTop: 18, color: '#e3dccf' }}>
            {firstName ? `${firstName}, you` : 'You'} just took the step most renters skip: learning what they may see, before they see it.
            {email && <> Your receipt and access link are on their way to <strong>{email}</strong>.</>}
          </p>
          <div className="cta-row" style={{ justifyContent: 'center', marginTop: 28 }}>
            <CtaLink to="/access" props={{ cta_location: 'welcome_guide', product: 'guide' }}>Go to my access page</CtaLink>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="up-h">
        <div className="wrap grid-2">
          <div className="stack">
            <span className="kicker">Optional — whenever you’re ready</span>
            <h2 id="up-h">Want the tools to act on what you read?</h2>
            <p className="lede">
              Upgrade to the RentReady Digital Bundle and your {PRODUCTS.guide.priceLabel} counts in full. You pay {PRODUCTS.upgrade.priceLabel} for the
              dispute letters and video guide — and you can start on them today, before your book arrives.
            </p>
            <ul className="checklist">
              {PRODUCTS.upgrade.includes.map((t) => (
                <li key={t}><Icon name="check" /><span>{t}</span></li>
              ))}
            </ul>
            <div className="cta-row">
              <CtaLink to="/checkout?product=upgrade" props={{ cta_location: 'welcome_upgrade', product: 'upgrade' }}>
                Upgrade for {PRODUCTS.upgrade.priceLabel}
              </CtaLink>
              <Link to="/access" className="text-link">No thanks — take me to my book</Link>
            </div>
            <p className="fine">This offer stays on your access page. We won’t ask again here.</p>
          </div>
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <BundleImage />
          </div>
        </div>
      </section>
    </Layout>
  );
}
