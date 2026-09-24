// Integrated legacy page source: Apartment Approval Preparation Kit.
// The imported .html/.css/.js files are the source of truth for this route.
import bodyHtml from './page.html?raw';
import styles from './page.css?raw';
import headExtras from './head-extras.html?raw';
import script0 from './script-0.js?raw';
import { useLegacyPage } from '../../legacy/useLegacyPage';

export default function ApartmentApprovalPreparationKit() {
  const containerRef = useLegacyPage({
    title: "RentReady — Apartment Approval Preparation Kit",
    headExtras,
    styles,
    bodyHtml,
    scripts: [script0],
  });
  return <div ref={containerRef} />;
}
