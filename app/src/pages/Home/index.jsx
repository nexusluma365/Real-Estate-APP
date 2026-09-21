// Legacy page source for the RentReady homepage.
import bodyHtml from './page.html?raw';
import styles from './page.css?raw';
import script0 from './script-0.js?raw';
import { useLegacyPage } from '../../legacy/useLegacyPage';

export default function Home() {
  const containerRef = useLegacyPage({
    title: 'RentReady - Know Where You Stand Before You Apply',
    styles,
    bodyHtml,
    scripts: [script0],
  });
  return <div ref={containerRef} />;
}
