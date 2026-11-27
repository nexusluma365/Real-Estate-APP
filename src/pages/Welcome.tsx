import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { CtaLink, useOnce } from '../components/ui';
import { Icon } from '../components/Icon';
import { PackageDownloads } from '../components/PackageDownloads';
import { dollars, PRODUCTS } from '../config/products';
import { track } from '../lib/analytics';
import { loadAssessment } from '../lib/assessmentStore';
import { useFunnel } from '../state/FunnelContext';

/**
 * Post-purchase welcome for every buyer: the downloads are right here (no waiting for the email), and the
 * "Your RentReady Digital Package Is Ready!" email follows from the webhook.
 * Complete Digital Bundle: eBook + letters + videos, then the bonus game plan. Digital eBook: the eBook.
 */
export default function Welcome() {
  const { owns, entitlements, firstName, lead } = useFunnel();
  const bundle = owns('creditready');
  const assessmentDone = !!loadAssessment().completedAt;
  const P = bundle ? PRODUCTS.creditready : PRODUCTS.guide;
  useOnce(() => track('thankyou_view', { product: bundle ? 'creditready' : 'guide', order_value: dollars(P.priceCents) }));

  const items = [
    { name: 'Know Before They Say NO! — Digital eBook', note: 'PDF · read on any phone, tablet or computer' },
    ...(bundle
      ? [
          { name: '20 Editable Credit Dispute Letters', note: 'Microsoft Word files in one ZIP' },
          { name: 'Video Education Guides', note: 'Watch in your browser' },
        ]
      : []),
    ...(owns('playbook') ? [{ name: PRODUCTS.playbook.name, note: 'Rental screening, from the other side of the desk' }] : []),
  ];

  return (
    <Layout chrome="customer">
      <Seo title={bundle ? 'Your Complete Digital Bundle is ready' : 'Your digital eBook is ready'} noindex />
      <section className="celebrate">
        <div className="wrap wrap-narrow">
          <div className="seal"><Icon name="key" /></div>
          <h1 style={{ fontSize: 'var(--step-5)' }}>Your Next Chapter Starts Here.</h1>
          <p className="lede center" style={{ marginTop: 18, color: '#e3dccf' }}>
            {firstName ? `${firstName}, your` : 'Your'} {P.name} is ready — everything you purchased is available now.
            {lead?.email && <> Your digital package email is on its way to <strong>{lead.email}</strong>. Save it to come back anytime.</>}
          </p>

          <div className="owned" aria-label="Your package">
            {items.map((i) => (
              <div key={i.name} className="owned-item">
                <span className="ic"><Icon name="check" /></span>
                <span>
                  <strong>{i.name}</strong>
                  <br />
                  <span className="muted" style={{ fontSize: '0.92rem', color: 'var(--muted-on-ink)' }}>{i.note}</span>
                </span>
                <span className="tag tag-strong">Yours</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="next-h">
        <div className="wrap grid-2">
          <div className="stack">
            <span className="kicker">Your downloads</span>
            <h2 id="next-h">{bundle ? 'Start with the eBook, then the video guides.' : 'Start reading your eBook.'}</h2>
            <p className="lede">
              {bundle
                ? 'The eBook shows what a property may look at. The video guides walk you through disputing items you believe are inaccurate, and how to use your 20 letter templates.'
                : 'Learn what landlords may check, what can affect your application, and how to prepare before you pay another application fee.'}
            </p>
            {entitlements.status === 'loaded' && <PackageDownloads owned={entitlements.products} ctaLocation="welcome" />}
            {bundle && <p className="muted">Your letters are Microsoft Word files — fill in your details, print, and send them yourself.</p>}
            <div className="cta-row">
              <CtaLink to="/access" props={{ cta_location: 'welcome_access' }}>Go to my access page</CtaLink>
            </div>
            {bundle && (
              <p className="muted" style={{ marginTop: 8 }}>
                <strong>Bonus:</strong> a five-minute private assessment that turns your rent, income, credit and timing into a
                prioritized game plan. We don’t check your credit.{' '}
                {assessmentDone ? <Link to="/gameplan" className="text-link">View my game plan</Link> : <Link to="/assessment" className="text-link">Start my assessment</Link>}
              </p>
            )}
          </div>
          <div className="scenario" style={{ padding: 24 }}>
            <h3 style={{ fontSize: 'var(--step-1)', marginBottom: 16 }}>Keep your access</h3>
            <ul className="checklist">
              {[
                'Save the “Your RentReady Digital Package Is Ready!” email',
                'Its button signs you in for 7 days',
                'After that, enter your email on the access page for a fresh link',
                'Your access doesn’t expire — download again anytime',
              ].map((t) => (
                <li key={t}><Icon name="check" /><span>{t}</span></li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </Layout>
  );
}
