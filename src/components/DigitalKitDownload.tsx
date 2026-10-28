import { DIGITAL_KIT_FILE_KEY, RESOURCES } from '../config/resources';
import { env, isMock } from '../lib/env';
import { track } from '../lib/analytics';

const toolkit = RESOURCES.find((resource) => resource.fileKey === DIGITAL_KIT_FILE_KEY);

export function DigitalKitDownload({ ctaLocation }: { ctaLocation: string }) {
  if (isMock) {
    return <p className="fine">The toolkit download is available after production storage is connected.</p>;
  }
  if (!toolkit) throw new Error('Digital kit download resource is not configured.');

  return (
    <div className="stack" style={{ ['--s' as string]: '8px' }}>
      <a
        className="btn"
        href={`${env.apiBase}/files?key=${encodeURIComponent(toolkit.fileKey)}`}
        onClick={() => track('product_download', { product: 'creditready', resource: toolkit.id, cta_location: ctaLocation })}
      >
        Download your Credit Repair Toolkit
      </a>
      <p className="fine">Your physical book will be shipped to the address you provided at checkout.</p>
    </div>
  );
}
