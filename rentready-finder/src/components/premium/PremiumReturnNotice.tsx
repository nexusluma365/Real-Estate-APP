import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMember } from '../../context/MemberContext';
import { track } from '../../services/member';
import { CheckIcon, CloseIcon, InfoIcon } from '../ui/Icons';

/** Reads ?premium= after Stripe Checkout and tells the member what happened, then tidies the URL. */
export function PremiumReturnNotice() {
  const { refresh, premium, openOffer } = useMember();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'info'; text: string } | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const state = url.searchParams.get('premium');
    if (!state) return;
    url.searchParams.delete('premium');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (state === 'active') {
      track('membership_activated_view', { product: 'premium' });
      setMsg({ kind: 'ok', text: 'Welcome to RentReady Premium — second-chance listing details are unlocked.' });
      void refresh();
    } else if (state === 'canceled') setMsg({ kind: 'info', text: 'Checkout was canceled. You haven’t been charged.' });
    else if (state === 'offer') openOffer('', 'email_rejoin');
    else if (state === 'pending') {
      setMsg({ kind: 'info', text: 'We’re confirming your payment with Stripe — this page will update in a moment.' });
      let tries = 0;
      const t = window.setInterval(() => {
        tries++;
        void refresh();
        if (tries >= 6) window.clearInterval(t);
      }, 2500);
      return () => window.clearInterval(t);
    }
  }, [refresh, openOffer]);

  useEffect(() => {
    if (premium.active && msg?.text.startsWith('We’re confirming')) setMsg({ kind: 'ok', text: 'Payment confirmed — welcome to RentReady Premium.' });
  }, [premium.active, msg]);

  useEffect(() => {
    if (msg?.kind !== 'ok') return;
    const t = window.setTimeout(() => setMsg(null), 7000);
    return () => window.clearTimeout(t);
  }, [msg]);

  return (
    <AnimatePresence>
      {msg ? (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          className="fixed inset-x-3 top-[84px] z-[60] mx-auto flex max-w-[560px] items-start gap-3 rounded-[18px] bg-white p-4 text-[14px] text-navy-900 shadow-float ring-1 ring-black/5"
        >
          {msg.kind === 'ok' ? <CheckIcon size={20} className="mt-px shrink-0 text-gold-700" /> : <InfoIcon size={20} className="mt-px shrink-0 text-navy-600" />}
          <p className="flex-1 font-medium">{msg.text}</p>
          <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss" className="-m-1 rounded-full p-1 text-navy-600 hover:bg-offwhite"><CloseIcon size={18} /></button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
