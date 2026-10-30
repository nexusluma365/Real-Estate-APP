import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useMember } from '../../context/MemberContext';
import { HeartIcon, SearchIcon, ShieldCheckIcon } from '../ui/Icons';

const finderPath = (ref: string) => {
  const [kind, id] = ref.split(':');
  return kind === 'listing' ? `/listing/${encodeURIComponent(id)}` : `/property/${encodeURIComponent(id)}`;
};

/** Returning signed-in visitors: saved apartments, saved searches with real new-listing counts, membership status. */
export function WelcomeBack() {
  const { signedIn, summary, state, premium, openOffer } = useMember();
  if (!signedIn || !summary) return null;
  const totalNew = summary.searches.reduce((n, s) => n + s.new_count, 0);
  const status =
    state === 'active' ? (premium.cancel_at_period_end ? 'Premium · canceled, active until the end of this period' : 'Premium · Active')
      : state === 'past_due' ? 'Premium · payment due'
        : state === 'lapsed' ? 'Premium · not active'
          : 'Free account';

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      aria-labelledby="wb-title"
      className="mt-6 rounded-[26px] bg-white p-5 shadow-card ring-1 ring-black/[0.03] sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="wb-title" className="text-[20px] font-extrabold tracking-[-0.02em] text-navy-900">Welcome Back to RentReady{summary.first_name ? `, ${summary.first_name}` : ''}</h2>
          <p className="mt-0.5 text-[14px] text-charcoal/70">Continue your apartment search.</p>
        </div>
        <a href="/account" className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-bold ${state === 'active' ? 'bg-gold-100 text-gold-700' : 'bg-offwhite text-navy-700'}`}>
          <ShieldCheckIcon size={15} /> {status}
        </a>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-stone-500"><HeartIcon size={14} /> Saved apartments</p>
          {summary.saved.length ? (
            <ul className="mt-2 space-y-1">
              {summary.saved.slice(0, 3).map((s) => <li key={s.ref}><Link to={finderPath(s.ref)} className="text-[14px] font-semibold text-navy-800 hover:text-gold-700">{s.label}</Link></li>)}
              {summary.saved.length > 3 ? <li><a href="/account" className="text-[13px] text-charcoal/65 underline">All {summary.saved.length}</a></li> : null}
            </ul>
          ) : <p className="mt-2 text-[13.5px] text-charcoal/65">None yet — tap the heart on any apartment.</p>}
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-stone-500"><SearchIcon size={14} /> Recent searches</p>
          {summary.searches.length ? (
            <ul className="mt-2 space-y-1">
              {summary.searches.slice(0, 3).map((q) => (
                <li key={q.search_id}><Link to={`/?q=${encodeURIComponent(q.label)}`} reloadDocument className="text-[14px] font-semibold text-navy-800 hover:text-gold-700">{q.label}</Link></li>
              ))}
            </ul>
          ) : <p className="mt-2 text-[13.5px] text-charcoal/65">Save a search to come back to it.</p>}
        </div>
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-stone-500">New matching listings</p>
          {summary.searches.length ? (
            <p className="mt-2 text-[14px] text-navy-800">
              {totalNew ? <><strong>{totalNew}</strong> new since you saved your searches.</> : 'No new matching listings since you saved your searches.'}
            </p>
          ) : <p className="mt-2 text-[13.5px] text-charcoal/65">Shown here once you save a search.</p>}
          {state === 'signed_in' ? (
            <button type="button" onClick={() => openOffer('', 'welcome_back')} className="mt-2 text-[13px] font-semibold text-gold-700 underline underline-offset-2">Unlock second-chance listings</button>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}
