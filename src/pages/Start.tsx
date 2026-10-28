import { useLocation, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { Journey, useOnce } from '../components/ui';
import { WindowScene } from '../components/Visuals';
import { LeadForm } from '../components/LeadForm';
import { captureAttribution } from '../lib/attribution';

const safeNext = (v: string | null) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/learn');

export default function Start() {
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const next = safeNext(new URLSearchParams(search).get('next'));
  const toCheckout = next.startsWith('/checkout');

  useOnce(() => {
    const intent = new URLSearchParams(search).get('intent') || undefined;
    captureAttribution(search, pathname, intent);
  });

  return (
    <Layout chrome="focused">
      <Seo title="Start your RentReady plan" description="Tell us where to send your access and we’ll take you to the first step." />
      <section className="optin">
        <div className="optin-art" aria-hidden="true">
          <WindowScene />
        </div>
        <div className="optin-panel">
          <div className="optin-card">
            <Journey at={toCheckout ? 3 : 0} />
            <h1 style={{ fontSize: 'var(--step-4)' }}>{toCheckout ? 'Where should we send your access?' : 'Let’s build your RentReady plan.'}</h1>
            <p className="lede muted" style={{ marginTop: 14 }}>
              {toCheckout
                ? 'Your receipt and access link go here, so you can open your purchase on any device.'
                : 'Tell us where to send your access and we’ll take you to the first step.'}
            </p>
            <div style={{ marginTop: 32 }}>
              <LeadForm
                source="start"
                submitLabel={toCheckout ? 'Continue to secure checkout' : 'Continue my RentReady plan'}
                footnote={!toCheckout ? 'No payment on this step.' : undefined}
                onDone={() => navigate(next)}
              />
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
