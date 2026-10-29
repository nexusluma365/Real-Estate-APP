import { useEffect, useState } from 'react';
import { Reveal } from '../ui/Reveal';
import { Button } from '../ui/Button';
import { PinIcon } from '../ui/Icons';
import { PreviewCard, PropertyCard } from '../property/PropertyCard';
import { useFinder } from '../../context/FinderContext';
import { getFeaturedProperties, LIVE_DATA_ENABLED, ServiceNotConnectedError } from '../../services/api';
import type { Property } from '../../types/property';

const LAUNCH_CITY = (import.meta.env.VITE_LAUNCH_CITY as string | undefined) ?? 'Charlotte, NC';

export function FeaturedSection() {
  const { goTo } = useFinder();
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ok'; items: Property[] } | { kind: 'offline' }>({ kind: LIVE_DATA_ENABLED ? 'loading' : 'offline' });

  useEffect(() => {
    if (!LIVE_DATA_ENABLED) return;
    const ctrl = new AbortController();
    getFeaturedProperties(LAUNCH_CITY, ctrl.signal)
      .then((items) => setState({ kind: 'ok', items: items.slice(0, 6) }))
      .catch((e) => {
        if (e instanceof ServiceNotConnectedError || !ctrl.signal.aborted) setState({ kind: 'offline' });
      });
    return () => ctrl.abort();
  }, []);

  return (
    <section id="featured" aria-labelledby="featured-title" className="pb-8 pt-16 md:pt-20">
      <div className="container-site">
        <Reveal className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow">Communities</p>
            <h2 id="featured-title" className="section-title">
              Explore Apartment Communities
            </h2>
            <p className="mt-2 flex items-center gap-1.5 text-[13.5px] font-medium text-charcoal/65">
              <PinIcon size={15} className="text-gold-600" /> Showing: {LAUNCH_CITY}
            </p>
          </div>
          <Button variant="outline-dark" onClick={() => goTo('search', { focusSearch: true })}>
            View All Properties
          </Button>
        </Reveal>

        {state.kind === 'ok' && state.items.length ? (
          <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {state.items.map((p) => (
              <PropertyCard key={p.placeId} p={p} />
            ))}
          </div>
        ) : (
          <>
            <div className="mt-10 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Reveal key={i} delay={i * 0.06} className={i === 2 ? 'sm:hidden lg:block' : ''}>
                  <PreviewCard index={i} />
                </Reveal>
              ))}
            </div>
            <p className="mt-7 text-center text-[13px] text-charcoal/60">
              Live {LAUNCH_CITY} apartment communities from Google Places replace these layout previews once the data integration is connected.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
