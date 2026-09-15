// Migrated legacy page source: modern-apartments-premium.html.
// The imported .html/.css/.js files are now the source of truth for this route.
import bodyHtml from './page.html?raw';
import styles from './page.css?raw';
import headExtras from './head-extras.html?raw';
import script0 from './script-0.js?raw';
import { useLegacyPage } from '../../legacy/useLegacyPage';

export default function ModernApartmentsPremium() {
  const containerRef = useLegacyPage({
    title: "RentReady — Modern Apartment Collection",
    headExtras,
    styles,
    bodyHtml,
    scripts: [script0],
  });
  return <div ref={containerRef} />;
}
