import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useMember } from '../../context/MemberContext';
import { ApiError, getListings, memberAction, openBillingPortal, track, type ListingFilters, type RRListing } from '../../services/member';
import { ListingCard } from '../property/ListingCard';
import { BellIcon, CheckIcon, ShieldCheckIcon } from '../ui/Icons';
import { Skeleton } from '../ui/Loader';

type State = { kind: 'loading' } | { kind: 'ok'; listings: RRListing[]; locked: number; filteredOut: number } | { kind: 'none'; filteredOut: number } | { kind: 'error' };

/** RentReady's own sourced listings for the searched city (rent, beds, verification), with Premium unlocks and saved searches. */
export function RentReadyListings({ place, filters }: { place: string; filters?: ListingFilters }) {
  const { premium, state: member, openOffer } = useMember();
  const fkey = JSON.stringify(filters || {});
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [savedSearch, setSavedSearch] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    setSavedSearch('idle');
    getListings(place, filters, ctrl.signal)
      .then((d) => setState(d.listings.length ? { kind: 'ok', listings: d.listings, locked: d.locked_count, filteredOut: d.filtered_out } : { kind: 'none', filteredOut: d.filtered_out }))
      .catch((e) => !ctrl.signal.aborted && setState(e instanceof ApiError && e.code === 'bad_place' ? { kind: 'none', filteredOut: 0 } : { kind: 'error' }));
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, premium.active, fkey]);

  const saveSearch = async () => {
    if (!premium.active) {
      openOffer(`Save “${place}” and get an email when new listings match it.`, 'save_search');
      return;
    }
    setSavedSearch('saving');
    try {
      await memberAction({ action: 'save_search', place });
      setSavedSearch('saved');
      track('search_saved', { cta_location: 'finder_results' });
    } catch {
      setSavedSearch('error');
    }
  };

  return (
    <section aria-labelledby="rr-listings-title" className="mt-12">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">RentReady listings</p>
          <h3 id="rr-listings-title" className="mt-2 text-[20px] font-extrabold tracking-[-0.025em] text-navy-900">
            {filters?.secondChanceOnly ? `Verified second-chance apartments for ${place}` : `Rent, screening info and second-chance opportunities in ${place}`}
          </h3>
          <p className="mt-1 max-w-[620px] text-[13.5px] leading-relaxed text-charcoal/65">
            Each listing names its source and when we last checked it. “Verified second-chance” means the source publishes flexible screening — never a promise of approval.
          </p>
        </div>
        <button
          type="button"
          onClick={saveSearch}
          disabled={savedSearch === 'saving' || savedSearch === 'saved'}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-mist bg-white px-5 text-[13.5px] font-bold text-navy-700 transition-colors hover:border-navy-700 disabled:opacity-80"
        >
          {savedSearch === 'saved' ? <><CheckIcon size={17} className="text-gold-700" /> Search saved · alerts on</> : <><BellIcon size={17} /> {savedSearch === 'saving' ? 'Saving…' : 'Save search & get alerts'}</>}
        </button>
      </div>
      {savedSearch === 'error' ? <p role="alert" className="mt-3 text-[13px] font-medium text-[#B4553F]">That search couldn’t be saved. Please try again.</p> : null}

      {member === 'past_due' && !premium.active ? (
        <InactiveNotice text="Your last membership payment couldn’t be collected. You can still explore regular apartments." cta="Update Payment" onClick={() => void openBillingPortal(`${location.pathname}${location.search}`)} />
      ) : member === 'lapsed' ? (
        <InactiveNotice text="Your membership isn’t active. You can still explore regular apartments." cta="Reactivate Premium" onClick={() => openOffer('', 'reactivate')} />
      ) : null}

      {state.kind === 'loading' ? (
        <div className="mt-6 grid gap-7 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[380px] !rounded-[26px]" />)}
        </div>
      ) : state.kind === 'ok' ? (
        <>
          {state.locked && !premium.active ? (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-5 flex items-center gap-2.5 rounded-[18px] bg-gold-100/70 px-4 py-3 text-[13.5px] text-navy-800">
              <ShieldCheckIcon size={18} className="shrink-0 text-gold-700" />
              {state.locked} verified second-chance {state.locked === 1 ? 'apartment' : 'apartments'} here. Premium shows the full details.
            </motion.p>
          ) : null}
          <div className="mt-6 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {state.listings.filter((l) => !l.nearby).map((l) => <ListingCard key={l.listing_id} l={l} />)}
          </div>
          {state.listings.some((l) => l.nearby) ? (
            <>
              <p className="mt-8 text-[14px] font-semibold text-navy-800">
                {state.listings.some((l) => !l.nearby) ? 'No' : 'No verified'} second-chance apartments in {place} yet — here are some elsewhere in {state.listings.find((l) => l.nearby)!.state}:
              </p>
              <div className="mt-4 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
                {state.listings.filter((l) => l.nearby).map((l) => <ListingCard key={l.listing_id} l={l} />)}
              </div>
            </>
          ) : null}
          {state.filteredOut ? <p className="mt-4 text-[13px] text-charcoal/60">{state.filteredOut} more {state.filteredOut === 1 ? 'listing doesn’t' : 'listings don’t'} match your filters.</p> : null}
        </>
      ) : (
        <p className="mt-6 rounded-[22px] bg-white p-6 text-[14px] leading-relaxed text-charcoal/75 shadow-card">
          {state.kind === 'error'
            ? 'RentReady listings didn’t load. Please try the search again.'
            : state.filteredOut
              ? `No RentReady listings in ${place} match these filters (${state.filteredOut} ${state.filteredOut === 1 ? 'doesn’t' : 'don’t'}). Try widening rent or bedrooms.`
              : filters?.secondChanceOnly
                ? `We don’t have verified second-chance apartments in or near ${place} yet. Save this search and we’ll email you when one is added.`
                : `We don’t have verified listings for ${place} yet. Save this search and we’ll email you when new ones are added.`}
        </p>
      )}
    </section>
  );
}

function InactiveNotice({ text, cta, onClick }: { text: string; cta: string; onClick: () => void }) {
  return (
    <div role="status" className="mt-5 flex flex-col gap-3 rounded-[18px] border border-[#B4553F]/25 bg-white p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-[14.5px] font-bold text-navy-900">Premium Access Is Currently Unavailable</p>
        <p className="mt-0.5 text-[13.5px] text-charcoal/75">{text}</p>
      </div>
      <button type="button" onClick={onClick} className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-navy-700 px-5 text-[13.5px] font-bold text-white hover:bg-navy-900">{cta}</button>
    </div>
  );
}

