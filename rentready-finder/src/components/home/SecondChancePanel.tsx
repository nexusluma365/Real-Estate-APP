import { motion } from 'motion/react';
import { POLICY_LEVELS, type PolicyStatus } from '../../types/policy';
import { PolicyBadge } from '../property/PolicyBadge';
import { CloseIcon } from '../ui/Icons';

const ORDER: PolicyStatus[] = ['verified', 'flexible', 'unconfirmed'];

/** Explains the three verification levels whenever Second-Chance Options is active. */
export function SecondChancePanel({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      id="second-chance"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="mt-6 rounded-[28px] border border-gold/40 bg-gold-100/45 p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Second-Chance Options · On</p>
            <h3 className="mt-2 text-[20px] font-semibold text-navy-900">How we label rental policies</h3>
            <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-charcoal/75">
              Google Places does not tell us whether a property works with lower credit, collections, past evictions or prior denials. We only show a
              second-chance label when we have evidence, and every label links to its source and the date it was checked.
            </p>
          </div>
          <button type="button" onClick={onClose} className="-mr-1 -mt-1 shrink-0 rounded p-1.5 text-navy-700 hover:bg-white/70" aria-label="Turn off Second-Chance Options">
            <CloseIcon size={20} />
          </button>
        </div>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {ORDER.map((s, i) => (
            <li key={s} className="rounded-[20px] bg-white p-5 shadow-card">
              <div className="flex items-center justify-between">
                <PolicyBadge status={s} />
                <span className="text-[11px] font-semibold text-stone-500">Level {i + 1}</span>
              </div>
              <p className="mt-3 text-[15px] font-semibold text-navy-900">{POLICY_LEVELS[s].label}</p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-charcoal/70">{POLICY_LEVELS[s].description}</p>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-[12.5px] leading-relaxed text-charcoal/65">
          Results show <strong className="font-semibold text-navy-800">Verified Policy</strong> properties first, then{' '}
          <strong className="font-semibold text-navy-800">Potentially Flexible</strong> ones in a separate section. If nothing is verified nearby, we say
          so and offer general results separately. Policies change — always confirm screening requirements with the leasing office.
        </p>
      </div>
    </motion.div>
  );
}
