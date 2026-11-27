import { useState } from 'react';
import { Alert } from './ui';
import { Icon } from './Icon';
import { resourcesFor, type Resource } from '../config/resources';
import { getDownloadUrl } from '../lib/fileService';
import { emitLifecycle } from '../lib/lifecycle';
import { track } from '../lib/analytics';
import type { ProductId } from '../lib/types';

/**
 * Everything the signed-in buyer owns, as download buttons (the eBook for every package; letters and videos for the
 * Complete Digital Bundle). Each click asks the server for a fresh 1-minute signed link — nothing here is public.
 */
export function PackageDownloads({ owned, ctaLocation }: { owned: readonly ProductId[]; ctaLocation: string }) {
  const [notice, setNotice] = useState('');
  const items = resourcesFor(owned);
  async function open(r: Resource) {
    track('product_download', { product: r.product, resource: r.id, cta_location: ctaLocation });
    void emitLifecycle('product_accessed', { resource: r.id });
    try {
      const url = await getDownloadUrl(r.fileKey);
      if (url) window.location.assign(url);
      else setNotice(`“${r.title}” opens here once private file storage is connected (development mode).`);
    } catch {
      setNotice('That file didn’t open. Try again, or contact support if it keeps happening.');
    }
  }
  return (
    <div className="stack" style={{ ['--s' as string]: '12px' }}>
      {notice && <Alert kind="info">{notice}</Alert>}
      <div className="resources">
        {items.map((r) => (
          <button key={r.id} className="res" type="button" onClick={() => open(r)}>
            <Icon name={r.icon} />
            <span>{r.title}<small>{r.kind === 'Video' ? 'Watch online' : 'Download'}</small></span>
          </button>
        ))}
      </div>
      <p className="fine">Each button makes a fresh private link, so you can download again any time from any device you sign in on.</p>
    </div>
  );
}
