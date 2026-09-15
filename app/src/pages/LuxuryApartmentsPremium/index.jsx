// Migrated legacy page source: luxury-apartments-premium.html.
// The imported .html/.css/.js files are now the source of truth for this route.
import bodyHtml from './page.html?raw';
import styles from './page.css?raw';
import headExtras from './head-extras.html?raw';
import script0 from './script-0.js?raw';
import { useLegacyPage } from '../../legacy/useLegacyPage';

export default function LuxuryApartmentsPremium() {
  const containerRef = useLegacyPage({
    title: "RentReady — Luxury Apartment Collection",
    headExtras,
    styles,
    bodyHtml,
    scripts: [script0],
  });
  return <div ref={containerRef} />;
}
