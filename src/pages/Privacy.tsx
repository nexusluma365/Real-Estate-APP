import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { SITE } from '../config/site';

/**
 * /privacy — what RentReady actually collects and why, matching the code (leads, orders, membership, saved items,
 * first-party events). Review with counsel before launch; update this page whenever data handling changes.
 */
const SECTIONS: [string, string[]][] = [
  ['What we collect', [
    'Contact details you give us: your first name and email address (for example when you start checkout, claim the free-book offer, download the checklist or join RentReady Premium).',
    'Order and membership records: what you bought or subscribed to, amounts, dates and status. Card details are entered on Stripe’s secure forms and never reach or are stored by RentReady.',
    'Shipping address for the physical book, collected and stored by Stripe and used only to ship your order.',
    'Your optional quiz and assessment answers, used only to tailor your plan inside your account. They are never shared with advertising platforms.',
    'Account activity: apartments and searches you save, apartments you recently viewed and your alert settings.',
    'Basic usage events (for example “search completed” or “checkout started”) with a random session id, the page and the ad campaign that brought you, so we can see what works. No names, emails or credit information are included.',
  ]],
  ['Location', [
    'RentReady Finder can start near you using an approximate area (city and state) based on your IP address. It is labelled as approximate and is not stored.',
    'Your precise location is used only if you tap “Use My Location” and your browser asks for and receives your permission. It is used for that search and is not stored.',
  ]],
  ['How we use it', [
    'To provide what you asked for: orders, downloads, shipping updates, membership access, saved apartments and listing alerts.',
    'To send transactional emails (receipts, sign-in links, membership and billing notices). Marketing emails are sent only if you agreed to them, and every one has an unsubscribe link.',
    'To measure and improve the site and our advertising using the aggregated events above.',
  ]],
  ['Who we share it with', [
    'Service providers that run RentReady on our behalf: Stripe (payments and billing), Netlify (hosting), Supabase (database), Cloudflare (file downloads), Resend (email) and Google (apartment search and, if enabled, analytics/ads measurement).',
    'We do not sell your personal information. We do not share your quiz answers, assessment or credit-related information with advertisers, landlords or property managers.',
  ]],
  ['Your choices', [
    `Unsubscribe from marketing emails using the link in any email. Turn listing alerts on or off in My account. Cancel RentReady Premium any time in My account.`,
    `To ask for a copy of your information or for it to be deleted, email ${SITE.supportEmail}. We keep records we are required to keep (for example payment records) for as long as the law requires.`,
  ]],
  ['Cookies', [
    'RentReady uses one sign-in cookie to keep you signed in and to know what you can access. Analytics or advertising cookies are used only if enabled on this site and, where required, only after you consent.',
  ]],
];

export default function Privacy() {
  return (
    <Layout>
      <Seo title="Privacy | RentReady" description="What RentReady collects, why, who we share it with and your choices." />
      <section className="band">
        <div className="wrap" style={{ maxWidth: 760 }}>
          <h1 style={{ fontSize: 'var(--step-4)' }}>Privacy at RentReady</h1>
          <p className="lede" style={{ marginTop: 12 }}>In plain English: what we collect, why, and what you control.</p>
          {SECTIONS.map(([h, ps]) => (
            <section key={h} style={{ marginTop: 36 }}>
              <h2 style={{ fontSize: 'var(--step-2)' }}>{h}</h2>
              <ul className="stack" style={{ ['--s' as string]: '10px', marginTop: 12, paddingLeft: 20 }}>
                {ps.map((p) => <li key={p} className="muted" style={{ lineHeight: 1.6 }}>{p}</li>)}
              </ul>
            </section>
          ))}
          <p className="muted" style={{ marginTop: 36 }}>Questions: <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a></p>
        </div>
      </section>
    </Layout>
  );
}
