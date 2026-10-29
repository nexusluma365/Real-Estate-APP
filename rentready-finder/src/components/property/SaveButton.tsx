import { useMember } from '../../context/MemberContext';
import { HeartIcon } from '../ui/Icons';

/** Heart toggle. For non-members it opens the Premium offer instead of pretending to save. */
export function SaveButton({ refId, label, detail, className = '' }: { refId: string; label: string; detail?: string; className?: string }) {
  const { saved, toggleSave } = useMember();
  const on = saved.has(refId);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        void toggleSave(refId, label, detail);
      }}
      aria-pressed={on}
      aria-label={on ? `Remove ${label} from saved apartments` : `Save ${label}`}
      className={`grid h-10 w-10 place-items-center rounded-full bg-white/90 text-navy-700 shadow-card backdrop-blur-md transition-[transform,color] duration-200 hover:scale-105 hover:text-[#C2523E] ${on ? 'text-[#C2523E]' : ''} ${className}`}
    >
      <HeartIcon size={19} filled={on} />
    </button>
  );
}
