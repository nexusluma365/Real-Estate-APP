import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { Alert, Spinner, useOnce } from '../components/ui';
import { Icon } from '../components/Icon';
import { SITE } from '../config/site';
import { track } from '../lib/analytics';
import { ApiError } from '../lib/api';
import { isMock } from '../lib/env';
import { PREMIUM_INTRO, PREMIUM_PRICE, startPremium } from '../lib/memberService';
import { useFunnel } from '../state/FunnelContext';

const INCLUDES: [string, string][] = [
  ['Verified second-chance listings', 'Full details — name, address, contact and the screening policy the source publishes, with the source and the date we checked it.'],
  ['Saved apartments & searches', 'Keep a shortlist and the cities you’re watching in one account, on any device.'],
  ['New-listing alerts', 'An email when a new listing matches a saved search. Only new listings, never repeats.'],
  ['Recently viewed', 'Pick up where you left off.'],
  ['Preparation tools', 'Your account links to the Before-You-Apply checklist and screening resources.'],
  ['Account & billing in one place', 'Update your card, see invoices or cancel yourself, any time.'],
];

const FAQ: [string, string][] = [
  ['What do I pay?', `${PREMIUM_INTRO} for your first month. After that, ${PREMIUM_PRICE} per month, charged on the same day each month to the card you used, until you cancel. No sign-up fee and no other charges. The ${PREMIUM_INTRO} first month is for first-time members.`],
  ['How do I cancel?', 'Open My account → Manage membership. Cancellation takes effect at the end of the month you’ve paid for; you keep access until then and you won’t be charged again. We email you a confirmation with the date.'],
  ['What happens if a payment fails?', 'We email you and Stripe retries the payment over the following days. Your access continues for up to 7 days after the renewal date while the payment is retried. You can update your card from the email or your account. If the payment can’t be collected, the membership ends and you aren’t charged further.'],
  ['Refunds', `If something isn’t right, email ${SITE.supportEmail}. Refunds of membership charges are made through Stripe to the original card.`],
  ['Does Premium get me approved?', 'No. RentReady shows listings and what their sources publish about screening, and helps you prepare. Every application is decided by the property, and we can’t guarantee availability or approval.'],
  ['Where do the listings come from?', 'Each RentReady listing names its source (for example the property’s own website or leasing criteria) and when we last checked it. We only call a listing “verified second-chance” when that source publishes flexible screening.'],
];

/** /premium — the membership offer and its full terms (linked from the Finder offer and Stripe's customer portal). */
export default function Premium() {
  const { entitlements } = useFunnel();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useOnce(() => track('product_view', { product: 'premium' }));
  const active = !!entitlements.premium?.active;
  const returning = !!entitlements.premium?.had_premium && !active;

  async function join() {
    setBusy(true);
    setError('');
    track('primary_cta_click', { cta_location: 'premium_page', product: 'premium' });
    try {
      await startPremium('/finder/');
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError ? e.message : 'Checkout didn’t open. Please try again.');
    }
  }

  return (
    <Layout>
      <Seo title="RentReady Premium — second-chance listings, saved searches and alerts" description={`Unlock verified second-chance apartment details, save apartments and searches, and get new-listing alerts. ${PREMIUM_INTRO} for your first month, then ${PREMIUM_PRICE}/month. Cancel any time.`} />
      <div className="bk">
        <section className="bk-sec bk-dark" aria-labelledby="pm-h" style={{ paddingTop: 72 }}>
          <div className="wrap" style={{ maxWidth: 860 }}>
            <span className="bk-label">RentReady Premium</span>
            <h1 id="pm-h" className="bk-h2" style={{ marginTop: 12 }}>Find second-chance apartments. <em>Know what they ask for before you apply.</em></h1>
            <p className="bk-body bk-on-dark" style={{ marginTop: 16 }}>
              Unlock RentReady’s verified second-chance listings, keep a shortlist, and get an email when something new matches your search.
            </p>
            <p className="pm-price"><strong>{returning ? PREMIUM_PRICE : PREMIUM_INTRO}</strong> {returning ? 'per month' : 'for your first month'}<span>{returning ? 'Renews monthly until you cancel.' : `Then ${PREMIUM_PRICE}/month until you cancel. Cancel any time.`}</span></p>
            {error && <div style={{ marginTop: 16 }}><Alert kind="error">{error}</Alert></div>}
            <div className="pm-cta">
              {active ? (
                <>
                  <Link className="btn bk-btn" to="/account">Open my account</Link>
                  <a className="bk-link" href="/finder/">Search apartments</a>
                </>
              ) : (
                <>
                  <button className="btn bk-btn" onClick={join} disabled={busy || isMock}>
                    {busy ? <><Spinner /> Opening secure checkout…</> : returning ? `Rejoin for ${PREMIUM_PRICE}/month` : `Start for ${PREMIUM_INTRO}`}
                  </button>
                  <a className="bk-link" href="/finder/">Search apartments free first</a>
                </>
              )}
            </div>
            {isMock && <p className="fine" style={{ color: '#b4bdcd' }}>Membership checkout runs on the live site.</p>}
          </div>
        </section>

        <section className="bk-sec bk-white" aria-labelledby="pm-inc">
          <div className="wrap" style={{ maxWidth: 980 }}>
            <h2 id="pm-inc" className="bk-h2">What’s included</h2>
            <ul className="pm-grid">
              {INCLUDES.map(([t, d]) => (
                <li key={t}><Icon name="check" /><div><h3>{t}</h3><p>{d}</p></div></li>
              ))}
            </ul>
          </div>
        </section>

        <section className="bk-sec bk-ivory" id="terms" aria-labelledby="pm-terms">
          <div className="wrap" style={{ maxWidth: 820 }}>
            <h2 id="pm-terms" className="bk-h2">Membership terms, in plain English</h2>
            <div className="pm-faq">
              {FAQ.map(([q, a]) => (
                <details key={q} open={q === 'What do I pay?'}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
            <p className="bk-body" style={{ marginTop: 24 }}>
              Preparing to apply? <Link className="bk-link" to="/">Before They Say No™</Link> explains what property managers may review and how to prepare.
            </p>
          </div>
        </section>
      </div>
    </Layout>
  );
}
