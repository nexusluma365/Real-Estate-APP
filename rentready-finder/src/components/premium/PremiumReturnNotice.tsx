import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useMember } from '../../context/MemberContext';
import { track } from '../../services/member';
import { CheckIcon, CloseIcon, InfoIcon } from '../ui/Icons';

type Msg = { kind: 'ok' | 'info' | 'wait'; title?: string; text: string; listing?: string };

/**
 * After Stripe Checkout (?premium=active|pending|canceled, plus ?listing= when they unlocked a specific apartment):
 * confirms what happened and offers that apartment. "active" is only ever set by the server after it has confirmed
 * the payment with Stripe; the page still re-reads membership from the server rather than trusting the URL.
 */
export function PremiumReturnNotice() {
  const { refresh, premium, openOffer } = useMember();
  const navigate = useNavigate();
  const [msg, setMsg] = useState<Msg | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const state = url.searchParams.get('premium');
    if (!state) return;
    const listing = url.searchParams.get('listing') || undefined;
    url.searchParams.delete('premium');
    url.searchParams.delete('listing');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    const welcome: Msg = { kind: 'ok', title: 'Welcome to RentReady Premium!', text: 'Your membership is active. You can now explore premium rental opportunities.', listing };
    if (state === 'active') {
      track('membership_activated_view', { product: 'premium' });
      setMsg(welcome);
      void refresh();
    } else if (state === 'canceled') setMsg({ kind: 'info', text: 'Checkout was canceled. You haven’t been charged.' });
    else if (state === 'offer') openOffer('', 'email_rejoin');
    else if (state === 'pending') {
      setMsg({ kind: 'wait', title: 'Confirming your payment…', text: 'This usually takes a few seconds. This page will update by itself.', listing });
      let tries = 0;
      const t = window.setInterval(() => {
        tries++;
        void refresh();
        if (tries >= 12) {
          window.clearInterval(t);
          setMsg((m) => (m?.kind === 'wait' ? { kind: 'info', text: 'Your payment is still being confirmed. Refresh in a minute, or check your email for your welcome message.' } : m));
        }
      }, 2500);
      return () => window.clearInterval(t);
    }
  }, [refresh, openOffer]);

  useEffect(() => {
    if (premium.active && msg?.kind === 'wait') setMsg({ kind: 'ok', title: 'Welcome to RentReady Premium!', text: 'Your membership is active. You can now explore premium rental opportunities.', listing: msg.listing });
  }, [premium.active, msg]);

  useEffect(() => {
    if (msg?.kind !== 'ok' || msg.listing) return;
    const t = window.setTimeout(() => setMsg(null), 8000);
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
          className="fixed inset-x-3 top-[84px] z-[60] mx-auto flex max-w-[560px] items-start gap-3 rounded-[20px] bg-white p-4 text-[14px] text-navy-900 shadow-float ring-1 ring-black/5 sm:p-5"
        >
          {msg.kind === 'ok' ? <CheckIcon size={22} className="mt-px shrink-0 text-gold-700" /> : <InfoIcon size={22} className="mt-px shrink-0 text-navy-600" />}
          <div className="flex-1">
            {msg.title ? <p className="text-[16px] font-extrabold tracking-[-0.01em]">{msg.title}</p> : null}
            <p className={msg.title ? 'mt-0.5 text-charcoal/80' : 'font-medium'}>{msg.text}</p>
            {msg.kind === 'ok' && msg.listing ? (
              <button
                type="button"
                onClick={() => {
                  setMsg(null);
                  navigate(`/listing/${encodeURIComponent(msg.listing!)}`);
                }}
                className="mt-3 inline-flex h-10 items-center rounded-full bg-navy-700 px-5 text-[13.5px] font-bold text-white hover:bg-navy-900"
              >
                View Apartment Details
              </button>
            ) : null}
          </div>
          <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss" className="-m-1 rounded-full p-1 text-navy-600 hover:bg-offwhite"><CloseIcon size={18} /></button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
