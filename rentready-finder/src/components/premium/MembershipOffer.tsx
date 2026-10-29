import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMember } from '../../context/MemberContext';
import { ApiError, startMembershipCheckout, track } from '../../services/member';
import { CheckIcon, CloseIcon, LockIcon } from '../ui/Icons';
import { Loader } from '../ui/Loader';

const INCLUDES = [
  'Full details for verified second-chance listings: name, address, contact and the screening policy we found, with its source',
  'Save apartments and searches to your account',
  'Email alerts when new listings match a saved search',
  'Recently viewed apartments and your renter preparation checklist',
];

/** The RentReady Premium offer. Every price, renewal term and the way to cancel are stated before checkout. */
export function MembershipOffer() {
  const { offer, closeOffer, premium } = useMember();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const returning = !!premium.had_premium;

  useEffect(() => {
    if (!offer.open) return;
    setError('');
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeOffer();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [offer.open, closeOffer]);

  const join = async () => {
    setBusy(true);
    setError('');
    track('membership_checkout_started', { product: 'premium', value: returning ? 19.99 : 5 });
    try {
      // Come back to exactly this page (search, filters and the listing they were looking at).
      await startMembershipCheckout(`${location.pathname}${location.search}`);
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError && e.code === 'already_member' ? 'Your membership is already active — reload the page to see everything.' : e instanceof Error ? e.message : 'Checkout didn’t open. Please try again.');
    }
  };

  return (
    <AnimatePresence>
      {offer.open ? (
        <motion.div
          key="offer"
          className="fixed inset-0 z-[90] flex items-end justify-center bg-[#0E1522]/60 p-3 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && closeOffer()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="offer-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.35, ease: [0.22, 0.61, 0.36, 1] }}
            className="relative max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-[28px] bg-white p-6 shadow-float sm:p-8"
          >
            <button ref={closeRef} type="button" onClick={closeOffer} aria-label="Close" className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-offwhite text-navy-700 hover:bg-mist">
              <CloseIcon size={20} />
            </button>
            <span className="grid h-12 w-12 place-items-center rounded-full bg-navy-700 text-gold"><LockIcon size={22} /></span>
            <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-gold-700">RentReady Premium</p>
            <h2 id="offer-title" className="mt-2 text-[28px] font-extrabold leading-[1.1] tracking-[-0.03em] text-navy-900">
              {returning ? 'Rejoin RentReady Premium' : 'Unlock second-chance listings'}
            </h2>
            {offer.reason ? <p className="mt-2 text-[15px] leading-relaxed text-charcoal/75">{offer.reason}</p> : null}

            <div className="mt-6 rounded-[20px] bg-offwhite p-5">
              <p className="flex items-baseline gap-2 text-navy-900">
                <span className="text-[34px] font-extrabold tracking-[-0.03em]">{returning ? '$19.99' : '$5'}</span>
                <span className="text-[15px] font-semibold">{returning ? 'per month' : 'for your first month'}</span>
              </p>
              <p className="mt-1 text-[14px] text-charcoal/75">
                {returning ? 'Renews monthly until you cancel.' : 'Then $19.99 per month, renewing monthly until you cancel.'}
              </p>
            </div>

            <ul className="mt-5 space-y-2.5">
              {INCLUDES.map((t) => (
                <li key={t} className="flex gap-2.5 text-[14px] leading-relaxed text-charcoal/85">
                  <CheckIcon size={18} className="mt-0.5 shrink-0 text-gold-700" />
                  {t}
                </li>
              ))}
            </ul>

            <div className="mt-6 space-y-1.5 text-[12.5px] leading-relaxed text-charcoal/65">
              <p><strong className="font-semibold text-navy-800">How billing works:</strong> you pay {returning ? '$19.99' : '$5.00'} today on Stripe’s secure checkout. Each month after that, $19.99 is charged to the same card until you cancel. No other fees.</p>
              <p><strong className="font-semibold text-navy-800">Cancel any time</strong> from your account in two clicks. You keep access until the end of the month you paid for, and you won’t be charged again.</p>
              <p>RentReady shows listings and the screening information their sources publish. We can’t guarantee availability or that any property will approve your application.</p>
            </div>

            {error ? <p role="alert" className="mt-4 rounded-[14px] bg-[#B4553F]/10 p-3 text-[13.5px] font-medium text-[#8E3F2D]">{error}</p> : null}
            <button
              type="button"
              onClick={join}
              disabled={busy}
              className="mt-6 inline-flex h-14 w-full items-center justify-center gap-2 rounded-full bg-navy-700 text-[16px] font-bold text-white shadow-pill transition-colors hover:bg-navy-900 disabled:opacity-70"
            >
              {busy ? <><Loader size="sm" tone="light" /> Opening secure checkout…</> : returning ? 'Rejoin for $19.99/month' : 'Start for $5'}
            </button>
            <p className="mt-3 text-center text-[12px] text-charcoal/55">
              <a href="/premium#terms" className="underline underline-offset-2 hover:text-navy-700">Membership terms</a> · Payments by Stripe
            </p>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
