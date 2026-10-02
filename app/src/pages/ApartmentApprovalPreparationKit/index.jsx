// Integrated legacy page source: Second Chance Rental Plan.
// The imported .html/.css/.js files are the source of truth for this route.
import bodyHtml from './page.html?raw';
import styles from './page.css?raw';
import headExtras from './head-extras.html?raw';
import script0 from './script-0.js?raw';
import { useLegacyPage } from '../../legacy/useLegacyPage';

export default function ApartmentApprovalPreparationKit() {
  const containerRef = useLegacyPage({
    title: "RentReady — Second Chance Rental Plan",
    headExtras,
    styles,
    bodyHtml,
    scripts: [script0],
  });
  return <div ref={containerRef} />;
}
