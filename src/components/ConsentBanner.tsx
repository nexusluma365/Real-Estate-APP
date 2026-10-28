import { useState } from 'react';
import { consentRequired, getConsent, setConsent } from '../lib/analytics';
import { SITE } from '../config/site';

/** Renders only when VITE_REQUIRE_TRACKING_CONSENT=true. Until a choice, ad + analytics storage stay denied. */
export function ConsentBanner() {
  const [open, setOpen] = useState(() => consentRequired() && !getConsent());
  if (!open) return null;
  const choose = (c: 'granted' | 'denied') => {
    setConsent(c);
    setOpen(false);
  };
  return (
    <div className="consent" role="region" aria-label="Cookie choices">
      <p>
        We use cookies to measure our ads and improve this site. We never share your email, answers or anything about your
        credit with ad platforms.{SITE.privacyUrl && <> <a href={SITE.privacyUrl}>Privacy policy</a>.</>}
      </p>
      <div>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => choose('denied')}>Decline</button>
        <button type="button" className="btn btn-sm" onClick={() => choose('granted')}>Accept</button>
      </div>
    </div>
  );
}
