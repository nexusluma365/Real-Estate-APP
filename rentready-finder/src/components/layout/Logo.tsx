/**
 * The RentReady logo, identical to the main site's (src/components/Logo.tsx there): gold house outline with a
 * light-blue door and the "RentReady" wordmark in the same system typeface, weight and tracking.
 */
const WORDMARK_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";

export function Logo({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  return (
    <span className="flex items-center gap-[10px]">
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M7 25V12.5L16 6.5l9 6V25" fill="none" stroke="#C49A55" strokeWidth="2" strokeLinejoin="round" />
        <rect x="13" y="15.5" width="6" height="9.5" fill="#9CC3DD" />
        <path d="M5 25h22" stroke="#C49A55" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span
        className={`text-[1.35rem] font-bold leading-none ${tone === 'light' ? 'text-white' : 'text-navy-900'}`}
        style={{ fontFamily: WORDMARK_FONT, letterSpacing: '-0.035em' }}
      >
        RentReady
      </span>
    </span>
  );
}
