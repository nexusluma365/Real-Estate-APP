import { useEffect, useState } from 'react';
import { Reveal } from '../ui/Reveal';
import { Button } from '../ui/Button';
import { PinIcon } from '../ui/Icons';
import { Skeleton } from '../ui/Loader';
import { PreviewCard, PropertyCard } from '../property/PropertyCard';
import { ListingCard } from '../property/ListingCard';
import { useFinder } from '../../context/FinderContext';
import { useMember } from '../../context/MemberContext';
import { getFeaturedProperties, LIVE_DATA_ENABLED, ServiceNotConnectedError } from '../../services/api';
import { getListings, type RRListing } from '../../services/member';
import type { Property } from '../../types/property';

const LAUNCH_CITY = (import.meta.env.VITE_LAUNCH_CITY as string | undefined) ?? 'Charlotte, NC';

/**
 * "View Second Chance Communities In This Area": RentReady's VERIFIED second-chance listings for the visitor's area
 * (locked for non-members — the server sends only rent, city and beds), then the Google communities, free.
 * Google results are never presented as second-chance.
 */
export function FeaturedSection() {
  const { goTo, area } = useFinder();
  const { premium } = useMember();
  const place = area || LAUNCH_CITY;
  const [sc, setSc] = useState<{ kind: 'loading' } | { kind: 'ok'; items: RRListing[] } | { kind: 'none' }>({ kind: 'loading' });
  const [google, setGoogle] = useState<{ kind: 'loading' } | { kind: 'ok'; items: Property[] } | { kind: 'offline' }>({ kind: LIVE_DATA_ENABLED ? 'loading' : 'offline' });

  useEffect(() => {
    const ctrl = new AbortController();
    setSc({ kind: 'loading' });
    getListings(place, { minRent: null, maxRent: null, bedrooms: null, secondChanceOnly: true }, ctrl.signal)
      .then((d) => setSc(d.listings.length ? { kind: 'ok', items: d.listings.slice(0, 6) } : { kind: 'none' }))
      .catch(() => !ctrl.signal.aborted && setSc({ kind: 'none' }));
    return () => ctrl.abort();
  }, [place, premium.active]);

  useEffect(() => {
    if (!LIVE_DATA_ENABLED) return;
    const ctrl = new AbortController();
    setGoogle({ kind: 'loading' });
    getFeaturedProperties(place, ctrl.signal)
      .then((items) => setGoogle({ kind: 'ok', items: items.slice(0, 6) }))
      .catch((e) => {
        if (e instanceof ServiceNotConnectedError || !ctrl.signal.aborted) setGoogle({ kind: 'offline' });
      });
    return () => ctrl.abort();
  }, [place]);

  const nearbyState = sc.kind === 'ok' && sc.items.every((l) => l.nearby) ? sc.items[0].state : null;

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
              {nearbyState ? ` · none listed here yet, these are elsewhere in ${nearbyState}` : ''}
            </p>
          </div>
          <Button variant="outline-dark" onClick={() => goTo('search', { focusSearch: true })}>
            Change Area
          </Button>
        </Reveal>

        {sc.kind === 'loading' ? (
          <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[380px] !rounded-[26px]" />)}
          </div>
        ) : sc.kind === 'ok' ? (
          <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {sc.items.map((l) => <ListingCard key={l.listing_id} l={l} />)}
          </div>
        ) : (
          <p className="mt-10 rounded-[22px] bg-white p-6 text-[14.5px] leading-relaxed text-charcoal/75 shadow-card">
            We don’t have verified second-chance communities in or near {place} yet. We only list a community here when its own
            published criteria show flexible screening — search above and save it to be emailed when one is added.
          </p>
        )}
        <p className="mt-5 text-[12.5px] leading-relaxed text-charcoal/60">
          “Second-chance” means the property’s source publishes flexible screening criteria. It isn’t a promise of approval — the property makes the final decision.
        </p>

        <Reveal className="mt-16">
          <h3 className="text-[24px] font-extrabold tracking-[-0.025em] text-navy-900">More Apartment Communities</h3>
          <p className="mt-1 text-[13.5px] text-charcoal/65">From Google. Screening policies for these are not confirmed.</p>
        </Reveal>
        {google.kind === 'ok' && google.items.length ? (
          <div className="mt-8 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {google.items.map((p) => <PropertyCard key={p.placeId} p={p} />)}
          </div>
        ) : google.kind === 'loading' ? (
          <div className="mt-8 grid gap-7 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[380px] !rounded-[26px]" />)}
          </div>
        ) : (
          <div className="mt-8 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Reveal key={i} delay={i * 0.06} className={i === 2 ? 'sm:hidden lg:block' : ''}>
                <PreviewCard index={i} />
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
