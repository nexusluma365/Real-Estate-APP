import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';

export default function NotFound() {
  return (
    <Layout>
      <Seo title="Page not found | RentReady" noindex />
      <div className="state-page">
        <div className="state-card stack">
          <h1 style={{ fontSize: 'var(--step-4)' }}>That page isn’t here.</h1>
          <p className="muted">The link may be old or mistyped. Start from the beginning, or open your access page.</p>
          <div className="cta-row" style={{ justifyContent: 'center' }}>
            <Link className="btn" to="/">Go to RentReady</Link>
            <Link className="btn btn-outline" to="/access">My access</Link>
          </div>
        </div>
      </div>
    </Layout>
  );
}
