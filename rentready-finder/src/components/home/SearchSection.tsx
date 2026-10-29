import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { LocationCombobox } from './LocationCombobox';
import { SecondChancePanel } from './SecondChancePanel';
import { Button } from '../ui/Button';
import { FieldLabel, Select, TextInput } from '../ui/Field';
import { BuildingIcon, HouseIcon, InfoIcon, KeyIcon, LocateIcon, PinIcon, SearchIcon, SlidersIcon } from '../ui/Icons';
import { SearchLoader } from '../ui/HelloLoader';
import { RentReadyListings } from './RentReadyListings';
import { track } from '../../services/member';
import { Loader } from '../ui/Loader';
import { PropertyCard } from '../property/PropertyCard';
import { useFinder } from '../../context/FinderContext';
import { searchProperties, ServiceNotConnectedError, type SearchResponse } from '../../services/api';
import { DEFAULT_FILTERS, type LocationSuggestion, type SearchFilters } from '../../types/property';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string }
  | { kind: 'results'; data: SearchResponse }
  | { kind: 'not-connected'; label: string }
  | { kind: 'error'; message: string };

const LOCATION_RE = /^[\p{L}\d][\p{L}\d\s.,'#\-/]{1,119}$/u;

function validateLocation(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Enter a city, state, ZIP code, or address.';
  if (v.length < 2) return 'Please enter at least 2 characters.';
  if (!LOCATION_RE.test(v)) return 'That location contains characters we can’t search. Try a city, ZIP code, or street address.';
  return null;
}

export function SearchSection() {
  const { filters, setFilters, secondChanceMode, clearSecondChance } = useFinder();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LocationSuggestion | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  /** The city searched by name: drives RentReady listings and is kept in the URL (?q=) so refresh/checkout return to it. */
  const [place, setPlace] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const open = () => setShowFilters(true);
    window.addEventListener('rr:open-filters', open);
    return () => window.removeEventListener('rr:open-filters', open);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Arriving with ?q= (a shared link, a refresh, or the return from membership checkout) re-runs that search.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')?.trim();
    if (!q || validateLocation(q)) return;
    setQuery(q);
    runSearch(q, { text: q });
    window.setTimeout(() => document.getElementById('search')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = (label: string, q: Parameters<typeof searchProperties>[0]) => {
    abortRef.current?.abort(); // cancel any previous search
    track('finder_search', { cta_location: q.coords ? 'location' : 'text' });
    if (q.text) {
      setPlace(q.text);
      const url = new URL(window.location.href);
      url.searchParams.set('q', q.text);
      url.searchParams.delete('premium');
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      // "Back to search" on detail pages returns here (router paths are relative to /finder).
      try {
        sessionStorage.setItem('rr.finder.lastSearch', `/?q=${encodeURIComponent(q.text)}`);
      } catch {
        /* storage unavailable */
      }
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus({ kind: 'loading', label });
    // hard client timeout so the loader can never spin indefinitely
    const timeout = window.setTimeout(() => ctrl.abort(), 15000);
    searchProperties(q, filters, ctrl.signal)
      .then((data) => setStatus({ kind: 'results', data }))
      .catch((e: unknown) => {
        if (e instanceof ServiceNotConnectedError) setStatus({ kind: 'not-connected', label });
        else if (e instanceof DOMException && e.name === 'AbortError') {
          if (abortRef.current === ctrl) setStatus({ kind: 'error', message: 'The search took too long. Please try again.' });
        } else setStatus({ kind: 'error', message: 'Something went wrong while searching. Please try again.' });
      })
      .finally(() => window.clearTimeout(timeout));
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (coords && query === 'Current location') {
      runSearch('your current location', { coords });
      return;
    }
    const msg = validateLocation(query);
    setError(msg);
    if (msg) {
      document.getElementById('location-input')?.focus();
      return;
    }
    runSearch(query.trim(), selected ? { placeId: selected.placeId, text: query.trim() } : { text: query.trim() });
  };

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setError('Your browser doesn’t support location sharing. Please type a city or ZIP code.');
      return;
    }
    setLocating(true);
    setError(null);
    // Permission is requested only now, after the visitor explicitly asked.
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSelected(null);
        setQuery('Current location');
      },
      (err) => {
        setLocating(false);
        setError(err.code === err.PERMISSION_DENIED ? 'Location permission was declined. You can type a city or ZIP code instead.' : 'We couldn’t determine your location. Please type a city or ZIP code.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  const set = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v === '' ? null : Number(v));
  const activeFilterCount = (Object.keys(DEFAULT_FILTERS) as (keyof SearchFilters)[]).filter((k) => filters[k] !== DEFAULT_FILTERS[k]).length;
  const listingFiltersSet = filters.minRent !== null || filters.maxRent !== null || filters.bedrooms !== null || filters.bathrooms !== null;

  const bedsLabel = filters.bedrooms === null ? 'Any' : filters.bedrooms === 0 ? 'Studio' : `${filters.bedrooms}+ beds`;
  const rentLabel =
    filters.minRent === null && filters.maxRent === null ? 'Any' : `${filters.minRent !== null ? `$${filters.minRent}` : '$0'} – ${filters.maxRent !== null ? `$${filters.maxRent}` : 'Any'}`;
  const typeLabel = { any: 'Any type', apartment: 'Apartments', townhome: 'Townhomes', condo: 'Condos' }[filters.propertyType];
  const openFilters = () => setShowFilters(true);
  const tiles: { label: string; value: string; icon: ReactNode; onClick: () => void; pressed?: boolean }[] = [
    { label: 'Distance', value: `${filters.radiusMiles} miles`, icon: <PinIcon size={15} />, onClick: openFilters },
    { label: 'Bedrooms', value: bedsLabel, icon: <HouseIcon size={15} />, onClick: openFilters },
    { label: 'Monthly rent', value: rentLabel, icon: <SlidersIcon size={15} />, onClick: openFilters },
    { label: 'Property type', value: typeLabel, icon: <BuildingIcon size={15} />, onClick: openFilters },
    {
      label: 'Second-chance',
      value: secondChanceMode ? 'On' : 'Off',
      icon: <KeyIcon size={15} />,
      pressed: secondChanceMode,
      onClick: () => (secondChanceMode ? clearSecondChance() : set('secondChance', 'verified')),
    },
  ];

  return (
    <section id="search" aria-labelledby="search-title" className="relative z-20 -mt-36 scroll-mt-28 pb-6 md:-mt-40">
      <div className="container-site">
        <motion.form
          onSubmit={onSubmit}
          noValidate
          role="search"
          aria-label="Apartment search"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          className="rounded-[30px] bg-white/95 p-4 shadow-float ring-1 ring-black/[0.04] backdrop-blur-xl sm:p-6"
        >
          <h2 id="search-title" className="sr-only">
            Search apartment communities
          </h2>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex-1">
              <label htmlFor="location-input" className="sr-only">
                Location
              </label>
              <LocationCombobox
                value={query}
                onChange={(v) => {
                  setQuery(v);
                  setSelected(null);
                  setCoords(null);
                  if (error) setError(null);
                }}
                onSelect={(s) => {
                  setSelected(s);
                  setQuery(`${s.primaryText}${s.secondaryText ? `, ${s.secondaryText}` : ''}`);
                }}
                invalid={!!error}
                describedBy={error ? 'location-error' : undefined}
              />
            </div>
            <div className="flex gap-3">
              <Button
                variant="outline-dark"
                size="lg"
                className="h-14 w-14 shrink-0 !px-0 sm:w-auto sm:flex-1 sm:!px-7 lg:flex-none"
                onClick={useMyLocation}
                disabled={locating}
                aria-label={locating ? 'Locating…' : 'Use My Location'}
                icon={locating ? <Loader size="sm" /> : <LocateIcon size={18} />}
              >
                <span className="hidden sm:inline">{locating ? 'Locating…' : 'Use My Location'}</span>
              </Button>
              <Button type="submit" size="lg" className="h-14 flex-1 px-9 lg:flex-none" disabled={status.kind === 'loading'} icon={<SearchIcon size={18} />}>
                Search Now
              </Button>
            </div>
          </div>
          {error ? (
            <p id="location-error" role="alert" className="mt-3 px-2 text-[13.5px] font-medium text-[#B4553F]">
              {error}
            </p>
          ) : null}

          <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 lg:gap-3">
            {tiles.map((t, i) => (
              <motion.li
                key={t.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.75 + i * 0.06, ease: [0.22, 0.61, 0.36, 1] }}
                className={i === 4 ? 'col-span-2 sm:col-span-1' : ''}
              >
                <button
                  type="button"
                  onClick={t.onClick}
                  aria-pressed={t.pressed}
                  aria-controls={t.pressed === undefined ? 'filters-panel' : undefined}
                  className={`group flex w-full flex-col items-start gap-1.5 rounded-[18px] border px-4 py-3 text-left transition-[background-color,border-color,transform,box-shadow] duration-300 ease-lux hover:-translate-y-0.5 hover:shadow-card ${
                    t.pressed ? 'border-gold/60 bg-gold-100/70' : 'border-mist bg-offwhite hover:border-navy-100 hover:bg-white'
                  }`}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">{t.label}</span>
                  <span className="flex items-center gap-2 text-[15px] font-bold tracking-[-0.01em] text-navy-900">
                    <span className={`grid h-6 w-6 place-items-center rounded-full ${t.pressed ? 'bg-gold text-navy-900' : 'bg-navy-700 text-white'}`}>{t.icon}</span>
                    {t.value}
                  </span>
                </button>
              </motion.li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-3 px-1">
            <button
              id="filters-toggle"
              type="button"
              aria-expanded={showFilters}
              aria-controls="filters-panel"
              onClick={() => setShowFilters((s) => !s)}
              className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-navy-700 hover:text-gold-700"
            >
              <SlidersIcon size={18} />
              {showFilters ? 'Hide filters' : 'More filters'}
              {activeFilterCount ? <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] text-navy-900">{activeFilterCount}</span> : null}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {showFilters ? (
              <motion.div
                id="filters-panel"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
                className="overflow-hidden"
              >
                <div className="grid gap-5 px-1 pt-5 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <FieldLabel htmlFor="min-rent" hint="per month">Rent range</FieldLabel>
                    <div className="flex items-center gap-2">
                      <TextInput id="min-rent" inputMode="numeric" type="number" min={0} step={50} placeholder="Min $" value={filters.minRent ?? ''} onChange={(e) => set('minRent', num(e.target.value))} aria-label="Minimum monthly rent" />
                      <span className="text-stone-500">–</span>
                      <TextInput id="max-rent" inputMode="numeric" type="number" min={0} step={50} placeholder="Max $" value={filters.maxRent ?? ''} onChange={(e) => set('maxRent', num(e.target.value))} aria-label="Maximum monthly rent" />
                    </div>
                  </div>
                  <div>
                    <FieldLabel htmlFor="beds">Bedrooms</FieldLabel>
                    <Select id="beds" value={filters.bedrooms ?? ''} onChange={(e) => set('bedrooms', num(e.target.value))}>
                      <option value="">Any</option>
                      <option value="0">Studio</option>
                      <option value="1">1+</option>
                      <option value="2">2+</option>
                      <option value="3">3+</option>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="baths">Bathrooms</FieldLabel>
                    <Select id="baths" value={filters.bathrooms ?? ''} onChange={(e) => set('bathrooms', num(e.target.value))}>
                      <option value="">Any</option>
                      <option value="1">1+</option>
                      <option value="2">2+</option>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="ptype">Property type</FieldLabel>
                    <Select id="ptype" value={filters.propertyType} onChange={(e) => set('propertyType', e.target.value as SearchFilters['propertyType'])}>
                      <option value="any">Any</option>
                      <option value="apartment">Apartment community</option>
                      <option value="townhome">Townhomes</option>
                      <option value="condo">Condominiums</option>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="policy">Second-chance status</FieldLabel>
                    <Select id="policy" value={filters.secondChance} onChange={(e) => set('secondChance', e.target.value as SearchFilters['secondChance'])}>
                      <option value="any">All properties</option>
                      <option value="verified">Verified policy first</option>
                      <option value="flexible">Include potentially flexible</option>
                    </Select>
                  </div>
                  <div>
                    <FieldLabel htmlFor="radius" hint={`${filters.radiusMiles} mi`}>Distance</FieldLabel>
                    <input
                      id="radius"
                      type="range"
                      min={1}
                      max={30}
                      step={1}
                      value={filters.radiusMiles}
                      onChange={(e) => set('radiusMiles', Number(e.target.value))}
                      className="mt-4 w-full cursor-pointer accent-[#263750]"
                    />
                  </div>
                  <div className="flex items-end sm:col-span-2">
                    <button type="button" onClick={() => setFilters(DEFAULT_FILTERS)} className="h-12 text-[13px] font-semibold text-navy-700 underline-offset-4 hover:text-gold-700 hover:underline">
                      Reset filters
                    </button>
                  </div>
                </div>
                <p className="mt-5 flex gap-2.5 rounded-[18px] bg-offwhite p-4 text-[13px] leading-relaxed text-charcoal/75">
                  <InfoIcon size={18} className="mt-px shrink-0 text-gold-700" />
                  <span>
                    Google Places doesn’t provide rent, bedroom, bathroom or vacancy data. These filters are only applied when an authorized listing source supplies that
                    information — properties without it are <strong className="font-semibold">never silently hidden</strong>, and we’ll tell you whenever a filter couldn’t be applied.
                    {listingFiltersSet ? ' Your rent / bedroom / bathroom choices are saved for when that data is available.' : ''}
                  </span>
                </p>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.form>

        <AnimatePresence initial={false}>{secondChanceMode ? <SecondChancePanel onClose={clearSecondChance} /> : null}</AnimatePresence>

        <div aria-live="polite" className="min-h-[1px]">
          <SearchResults status={status} secondChance={secondChanceMode} onRetry={() => onSubmit(new Event('submit') as unknown as FormEvent)} />
        </div>
        {place && status.kind !== 'loading' ? <RentReadyListings place={place} /> : null}
      </div>
    </section>
  );
}

function SearchResults({ status, secondChance, onRetry }: { status: Status; secondChance: boolean; onRetry: () => void }) {
  if (status.kind === 'idle') return null;

  if (status.kind === 'loading') {
    return <SearchLoader label={status.label} />;
  }

  if (status.kind === 'not-connected') {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mt-8 rounded-[28px] bg-white p-8 text-center shadow-card sm:p-10">
        <p className="eyebrow">Live search not connected yet</p>
        <h3 className="mx-auto mt-3 max-w-[560px] text-[22px] font-semibold text-navy-900">Your search for “{status.label}” is ready to run</h3>
        <p className="mx-auto mt-3 max-w-[560px] text-[14.5px] leading-relaxed text-charcoal/70">
          The location was validated{secondChance ? ' and Second-Chance Options are on' : ''}. Real apartment communities will appear here once the Google Places
          integration is connected in the next build phase. We don’t show sample properties in the meantime.
        </p>
      </motion.div>
    );
  }

  if (status.kind === 'error') {
    return (
      <div className="mt-8 rounded-[28px] border border-[#B4553F]/25 bg-white p-8 text-center shadow-card">
        <h3 className="text-[19px] font-semibold text-navy-900">{status.message}</h3>
        <Button className="mt-5" variant="outline-dark" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  const { data } = status;
  const verified = data.properties.filter((p) => p.policyStatus === 'verified');
  const flexible = data.properties.filter((p) => p.policyStatus === 'flexible');
  const other = data.properties.filter((p) => p.policyStatus === 'unconfirmed');

  if (!data.properties.length) {
    return (
      <div className="mt-8 rounded-[28px] bg-white p-10 text-center shadow-card">
        <h3 className="text-[20px] font-semibold text-navy-900">No apartment communities found near {data.location.label}</h3>
        <p className="mt-2 text-[14.5px] text-charcoal/70">Try a nearby city, a ZIP code, or widen the distance filter.</p>
      </div>
    );
  }

  const Grid = ({ title, note, items }: { title: string; note?: string; items: typeof data.properties }) =>
    items.length ? (
      <div className="mt-10">
        <h3 className="text-[24px] font-extrabold tracking-[-0.025em] text-navy-900">{title}</h3>
        {note ? <p className="mt-1 text-[13.5px] text-charcoal/65">{note}</p> : null}
        <div className="mt-6 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <PropertyCard key={p.placeId} p={p} />
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className="mt-4">
      {data.unsupportedFilters.length ? (
        <ul className="mt-6 space-y-1 rounded-[18px] bg-gold-100/60 p-4 text-[13px] text-charcoal/80">
          {data.unsupportedFilters.map((u) => (
            <li key={u.filter}>• {u.reason}</li>
          ))}
        </ul>
      ) : null}
      {secondChance ? (
        <>
          {verified.length ? (
            <Grid title="Verified second-chance policies" items={verified} />
          ) : (
            <p className="mt-8 rounded-[18px] bg-white p-5 text-[14px] shadow-card text-charcoal/80">
              We didn’t find any properties near {data.location.label} with a verified second-chance policy yet.
            </p>
          )}
          <Grid title="Potentially flexible" note="Some evidence of flexibility — terms not fully confirmed." items={flexible} />
          <Grid title="Other apartment communities nearby" note="Rental policy not confirmed." items={other} />
        </>
      ) : (
        <Grid title={`Apartment communities near ${data.location.label}`} items={data.properties} />
      )}
    </div>
  );
}
