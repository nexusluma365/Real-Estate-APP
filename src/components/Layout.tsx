import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Logo } from './Logo';
import { Icon } from './Icon';
import { SITE } from '../config/site';
import { INTENTS } from '../config/intents';
import { isMock } from '../lib/env';
import { useFunnel } from '../state/FunnelContext';

type Chrome = 'marketing' | 'focused' | 'customer' | 'book';

/**
 * focused = checkout/upsell/opt-in: no navigation that pulls people out of the step.
 * book = the home page book launch: minimal header, simple footer.
 */
export function Layout({ children, chrome = 'marketing', headerCta }: { children: ReactNode; chrome?: Chrome; headerCta?: ReactNode }) {
  const { owns } = useFunnel();
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      {isMock && (
        <div className="mock-banner" role="note">
          Development mode — payments and access are simulated. No real charges.
        </div>
      )}
      <header className={`site-header${chrome === 'book' ? ' site-header-book' : ''}`}>
        <div className="wrap">
          <Logo />
          {chrome === 'marketing' && (
            <nav className="nav" aria-label="Main">
              <a className="nav-hide" href="/#how">How it works</a>
              <Link className="nav-hide" to="/">The book</Link>
              <Link to="/access">My access</Link>
              {headerCta}
            </nav>
          )}
          {chrome === 'book' && (
            <nav className="nav" aria-label="Main">
              <Link className="nav-hide" to="/access">My access</Link>
              {headerCta}
            </nav>
          )}
          {chrome === 'focused' && (
            <span className="secure-note">
              <Icon name="lock" width={16} height={16} /> Secure step
            </span>
          )}
          {chrome === 'customer' && (
            <nav className="nav" aria-label="Customer">
              {/* The game plan comes with the Digital Bundle; book-only owners don't have it. */}
              {owns('creditready') && <Link to="/gameplan">Game plan</Link>}
              <Link to="/access">My access</Link>
            </nav>
          )}
        </div>
      </header>
      <main id="main">{children}</main>
      {chrome === 'book' ? <BookFooter /> : <Footer minimal={chrome === 'focused'} />}
    </>
  );
}

function Footer({ minimal }: { minimal: boolean }) {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="wrap">
        {!minimal && (
          <div className="footer-grid">
            <div>
              <Logo />
              <p style={{ marginTop: 16, maxWidth: '26em' }}>
                Preparation for the apartment you actually want. Understand your credit, understand screening, and apply with more information.
              </p>
            </div>
            <div>
              <h4>Before you apply</h4>
              <ul>
                {INTENTS.slice(0, 4).map((i) => (
                  <li key={i.slug}>
                    <Link to={`/${i.slug}`}>{i.hero.headline.join(' ').replace(/[?.]$/, '')}</Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4>RentReady</h4>
              <ul>
                {INTENTS.slice(4).map((i) => (
                  <li key={i.slug}>
                    <Link to={`/${i.slug}`}>{i.hero.headline.join(' ').replace(/[?.]$/, '')}</Link>
                  </li>
                ))}
                <li><Link to="/access">Customer access</Link></li>
                <li><a href={`mailto:${SITE.supportEmail}`}>Contact support</a></li>
              </ul>
            </div>
          </div>
        )}
        <p className="footer-legal">
          {SITE.disclaimer} © {year} RentReady · {SITE.domain}
        </p>
      </div>
    </footer>
  );
}

/** Book launch footer: deliberately simple. Legal links render only when their URLs are configured. */
function BookFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer site-footer-book">
      <div className="wrap">
        <div className="book-footer-row">
          <div className="book-footer-brand">
            <Logo />
            <span>{SITE.book}</span>
          </div>
          <nav className="book-footer-links" aria-label="Footer">
            {SITE.privacyUrl && <a href={SITE.privacyUrl}>Privacy</a>}
            {SITE.termsUrl && <a href={SITE.termsUrl}>Terms</a>}
            <a href={`mailto:${SITE.supportEmail}`}>Contact</a>
            <Link to="/access">My access</Link>
          </nav>
        </div>
        <p className="footer-legal">{SITE.disclaimer}</p>
        <p className="book-footer-copy">© {year} RentReady · {SITE.domain}</p>
      </div>
    </footer>
  );
}

export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView();
        return;
      }
    }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}
