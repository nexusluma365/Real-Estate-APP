// Migrated legacy page source: after-payment-results/index.html.
// The imported .html/.css/.js files are now the source of truth for this route.
import bodyHtml from './page.html?raw';
import styles from './page.css?raw';
import headExtras from './head-extras.html?raw';
import script0 from './script-0.js?raw';
import { useLegacyPage } from '../../legacy/useLegacyPage';

export default function AfterPaymentResults() {
  const containerRef = useLegacyPage({
    title: "RentReady Network — Your rental profile scan",
    headExtras,
    styles,
    bodyHtml,
    scripts: [script0],
  });
  return <div ref={containerRef} />;
}
