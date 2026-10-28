import { useState } from 'react';
import { Icon } from './Icon';
import { track } from '../lib/analytics';
import { copyShareLink, shareLinks, shareUrl, SHARE_MESSAGE } from '../lib/share';
import { SITE } from '../config/site';

/** User-initiated sharing only. No contact import, no auto-send, no rewards. */
export function SharePanel() {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <section className="share" aria-labelledby="share-h">
      <h2 id="share-h" style={{ fontSize: 'var(--step-3)' }}>Know someone else getting ready to move?</h2>
      <p className="muted" style={{ marginTop: 10, color: 'var(--muted-on-ink)' }}>
        If RentReady helped, pass it on. Here’s what we’ll fill in — you can edit it before sending.
      </p>
      <blockquote style={{ margin: '18px 0 0', paddingLeft: 16, borderLeft: '2px solid var(--brass)', fontFamily: 'var(--serif)', fontSize: '1.1rem' }}>
        {SHARE_MESSAGE} <span style={{ color: 'var(--brass-hi)' }}>{SITE.domain}</span>
      </blockquote>
      {typeof navigator !== 'undefined' && 'share' in navigator && (
        <button
          className="btn btn-block"
          style={{ marginTop: 22 }}
          type="button"
          onClick={async () => {
            track('share_clicked', { method: 'native' });
            try {
              await navigator.share({ title: 'RentReady', text: SHARE_MESSAGE, url: shareUrl('native') });
            } catch {
              /* user cancelled */
            }
          }}
        >
          Share RentReady
        </button>
      )}
      <div className="share-actions" role="group" aria-label="Share RentReady">
        <button
          className="btn"
          type="button"
          onClick={async () => {
            track('share_clicked', { method: 'copy' });
            setCopied((await copyShareLink()) ? 'ok' : 'fail');
          }}
        >
          <Icon name="link" width={18} height={18} /> {copied === 'ok' ? 'Link copied' : 'Copy link'}
        </button>
        <a className="btn btn-outline" href={shareLinks.email()} onClick={() => track('share_clicked', { method: 'email' })}>
          <Icon name="mail" width={18} height={18} /> Email
        </a>
        <a className="btn btn-outline" href={shareLinks.sms()} onClick={() => track('share_clicked', { method: 'sms' })}>
          <Icon name="chat" width={18} height={18} /> Text
        </a>
      </div>
      <p className="fine" role="status" style={{ marginTop: 12, minHeight: '1.5em' }}>
        {copied === 'ok' && 'Copied. Paste it anywhere.'}
        {copied === 'fail' && `Copy didn’t work on this device. Share ${SITE.domain} directly.`}
      </p>
    </section>
  );
}
