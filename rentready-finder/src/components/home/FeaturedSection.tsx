import { useEffect, useState } from 'react';
import { Reveal } from '../ui/Reveal';
import { Button } from '../ui/Button';
import { PinIcon } from '../ui/Icons';
import { Skeleton } from '../ui/Loader';
import { ListingCard } from '../property/ListingCard';
import { useFinder } from '../../context/FinderContext';
import { useMember } from '../../context/MemberContext';
import { getListings, type RRListing } from '../../services/member';

const LAUNCH_CITY = (import.meta.env.VITE_LAUNCH_CITY as string | undefined) ?? 'Charlotte, NC';

/**
 * "View Second Chance Communities In This Area" — verified second-chance listings ONLY (never Google results, which
 * carry no screening information). The visitor's city first, then "More Second-Chance Apartments" (the rest of the
 * city plus other cities in the state, labelled). Non-members get blurred cards: rent, city, beds/baths, Unlock Access.
 */
export function FeaturedSection() {
  const { goTo, area } = useFinder();
  const { premium } = useMember();
  const place = area || LAUNCH_CITY;
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ok'; items: RRListing[] } | { kind: 'none' }>({ kind: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    getListings(place, { minRent: null, maxRent: null, bedrooms: null, secondChanceOnly: true, includeNearby: true }, ctrl.signal)
      .then((d) => setState(d.listings.length ? { kind: 'ok', items: d.listings } : { kind: 'none' }))
      .catch(() => !ctrl.signal.aborted && setState({ kind: 'none' }));
    return () => ctrl.abort();
  }, [place, premium.active]);

  const items = state.kind === 'ok' ? state.items : [];
  const own = items.filter((l) => !l.nearby);
  const elsewhere = items.filter((l) => l.nearby);
  // Lead with this city; if it has none yet, lead with the closest we have (labelled).
  const top = own.length ? own.slice(0, 6) : elsewhere.slice(0, 6);
  const more = own.length ? [...own.slice(6), ...elsewhere] : elsewhere.slice(6);
  const st = items[0]?.state;

  return (
    <section id="featured" aria-labelledby="featured-title" className="pb-8 pt-16 md:pt-20">
      <div className="container-site">
        <Reveal className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Second-chance communities</p>
            <h2 id="featured-title" className="section-title">
              View Second Chance Communities In This Area
            </h2>
            <p className="mt-2 flex items-center gap-1.5 text-[13.5px] font-medium text-charcoal/65">
              <PinIcon size={15} className="text-gold-600" /> Showing: {place}
              {state.kind === 'ok' && !own.length ? ` · none listed here yet, these are elsewhere in ${st}` : ''}
            </p>
          </div>
          <Button variant="outline-dark" onClick={() => goTo('search', { focusSearch: true })}>
            Change Area
          </Button>
        </Reveal>

        {state.kind === 'loading' ? (
          <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[380px] !rounded-[26px]" />)}
          </div>
        ) : state.kind === 'ok' ? (
          <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {top.map((l) => <ListingCard key={l.listing_id} l={l} />)}
          </div>
        ) : (
          <p className="mt-10 rounded-[22px] bg-white p-6 text-[14.5px] leading-relaxed text-charcoal/75 shadow-card">
            We don’t have verified second-chance communities in or near {place} yet. We only list a community here when its own
            published criteria show flexible screening — search above and save it to be emailed when one is added.
          </p>
        )}

        {more.length ? (
          <>
            <Reveal className="mt-16">
              <h3 className="text-[24px] font-extrabold tracking-[-0.025em] text-navy-900">More Second-Chance Apartments</h3>
              <p className="mt-1 text-[13.5px] text-charcoal/65">
                {own.length > 6 ? `More in ${place}` : ''}{own.length > 6 && elsewhere.length ? ' and ' : ''}
                {elsewhere.length ? `${own.length > 6 ? 'elsewhere' : 'Elsewhere'} in ${st} — each card shows its city.` : '.'}
              </p>
            </Reveal>
            <div className="mt-8 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
              {more.map((l) => <ListingCard key={l.listing_id} l={l} />)}
            </div>
          </>
        ) : null}

        <p className="mt-6 text-[12.5px] leading-relaxed text-charcoal/60">
          “Second-chance” means the property’s source publishes flexible screening criteria. It isn’t a promise of approval — the property makes the final decision.
        </p>
      </div>
    </section>
  );
}
