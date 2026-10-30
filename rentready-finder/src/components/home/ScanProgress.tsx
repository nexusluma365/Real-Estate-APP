import { motion } from 'motion/react';
import type { ScanStatus } from '../../hooks/useSecondChanceScan';

/** Honest progress while property websites are checked for published second-chance policies. */
export function ScanProgress({ place, scan, compact = false }: { place: string; scan: ScanStatus | null; compact?: boolean }) {
  const checking = !!scan && scan.pending > 0;
  const text = !scan
    ? `We don’t have second-chance apartments listed for ${place} yet.`
    : checking
      ? `Checking apartment websites in ${place} for published second-chance policies — ${scan.checked} checked, ${scan.pending} to go. New matches appear here automatically.`
      : scan.checked
        ? `We checked ${scan.checked} apartment ${scan.checked === 1 ? 'website' : 'websites'} in ${place}${scan.found ? ` and found ${scan.found} with a published second-chance policy` : ' and none publish a second-chance policy right now'}. Save this search to be emailed when that changes.`
        : `We don’t have second-chance apartments listed for ${place} yet. Save this search to be emailed when one is added.`;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
      aria-live="polite"
      className={`${compact ? 'mt-6 p-4 text-[13.5px]' : 'mt-10 p-6 text-[14.5px]'} flex items-start gap-3 rounded-[22px] bg-white leading-relaxed text-charcoal/75 shadow-card`}
    >
      {checking ? <span className="rr-loader rr-loader--sm mt-0.5 shrink-0" aria-hidden="true" /> : null}
      <p>
        {text}
        {!compact ? <span className="mt-2 block text-[12.5px] text-charcoal/55">We only list a property as second-chance when its own website says so — we show the exact words and the page they came from.</span> : null}
      </p>
    </motion.div>
  );
}
