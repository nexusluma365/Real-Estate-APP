import { POLICY_LEVELS, type PolicyStatus } from '../../types/policy';
import { ShieldCheckIcon, InfoIcon, KeyIcon } from '../ui/Icons';

const styles: Record<PolicyStatus, string> = {
  verified: 'bg-[#EAF1EA] text-[#2F5D3A] ring-[#2F5D3A]/15',
  flexible: 'bg-gold-100 text-gold-700 ring-gold/30',
  unconfirmed: 'bg-stone/70 text-charcoal/75 ring-charcoal/10',
};

export function PolicyBadge({ status, size = 'sm' }: { status: PolicyStatus; size?: 'sm' | 'md' }) {
  const Icon = status === 'verified' ? ShieldCheckIcon : status === 'flexible' ? KeyIcon : InfoIcon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full ring-1 ring-inset ${styles[status]} ${
        size === 'md' ? 'px-3 py-1.5 text-[13px]' : 'px-2.5 py-1 text-[12px]'
      } font-semibold`}
      title={POLICY_LEVELS[status].description}
    >
      <Icon size={size === 'md' ? 16 : 14} />
      {POLICY_LEVELS[status].short}
    </span>
  );
}
