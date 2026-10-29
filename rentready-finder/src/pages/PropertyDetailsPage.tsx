import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { getPropertyDetails, ServiceNotConnectedError, directionsUrl, photoUrl, telHref } from '../services/api';
import type { Property } from '../types/property';
import { Skeleton } from '../components/ui/Loader';
import { SmartImage } from '../components/ui/SmartImage';
import { PolicyBadge } from '../components/property/PolicyBadge';
import { LinkButton } from '../components/ui/Button';
import { ArrowLeftIcon, GlobeIcon, PhoneIcon, PinIcon, RouteIcon } from '../components/ui/Icons';
import { POLICY_LEVELS } from '../types/policy';
import { useMember } from '../context/MemberContext';
import { SaveButton } from '../components/property/SaveButton';
import { track } from '../services/member';

type State = { kind: 'loading' } | { kind: 'ok'; p: Property } | { kind: 'not-connected' } | { kind: 'error' };

export function PropertyDetailsPage() {
  const { placeId = '' } = useParams();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    window.scrollTo(0, 0);
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    getPropertyDetails(placeId, ctrl.signal)
      .then((p) => setState({ kind: 'ok', p }))
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setState(e instanceof ServiceNotConnectedError ? { kind: 'not-connected' } : { kind: 'error' });
      });
    return () => ctrl.abort();
  }, [placeId]);

  return (
    <div className="min-h-screen bg-offwhite pb-24 pt-[100px]">
      <div className="container-site">
        <Link to={sessionStorage.getItem('rr.finder.lastSearch') || '/'} className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-navy-700 hover:text-gold-700">
          <ArrowLeftIcon size={17} /> Back to search
        </Link>
        {state.kind === 'ok' ? <Details p={state.p} /> : <DetailsSkeleton state={state.kind} />}
      </div>
    </div>
  );
}

function DetailsSkeleton({ state }: { state: State['kind'] }) {
  return (
    <div className="mt-6">
      {state !== 'loading' ? (
        <div role="status" className="mb-6 rounded-[24px] border border-gold/40 bg-gold-100/50 p-5 text-[14px] leading-relaxed text-charcoal/80">
          <strong className="font-semibold text-navy-900">
            {state === 'not-connected' ? 'Property details aren’t connected yet.' : 'We couldn’t load this property.'}
          </strong>{' '}
          {state === 'not-connected'
            ? 'This page will show the live Google Places photo gallery, address, map, phone, website and rental-policy evidence once the integration is added. The layout below is a loading skeleton, not property data.'
            : 'Please go back and try again.'}
        </div>
      ) : (
        <span className="sr-only" role="status">Loading property details</span>
      )}
      <div className="grid gap-3 md:grid-cols-[2fr_1fr] md:grid-rows-2">
        <Skeleton className="aspect-[16/10] md:row-span-2 md:aspect-auto md:h-[460px]" />
        <Skeleton className="hidden md:block" />
        <Skeleton className="hidden md:block" />
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="space-y-2.5 pt-6">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
          <Skeleton className="mt-8 h-64 w-full" />
        </div>
        <div className="space-y-3 rounded-[24px] bg-white p-6 shadow-card">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </div>
  );
}

/** Live details view (fed by Phase C). Every section degrades honestly when data is missing. */
function Details({ p }: { p: Property }) {
  const [main, ...rest] = p.photos;
  const { recordView } = useMember();
  useEffect(() => {
    track('listing_view', { cta_location: 'place' });
    recordView(`place:${p.placeId}`, p.name, p.formattedAddress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.placeId]);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="mt-6">
      <div className="grid gap-3 md:grid-cols-[2fr_1fr] md:grid-rows-2">
        <SmartImage kind="property" eager src={main ? photoUrl(main.name, 1600) : null} alt={`${p.name}`} className="aspect-[16/10] rounded-[24px] md:row-span-2 md:aspect-auto md:h-[460px]" />
        {[0, 1].map((i) => (
          <SmartImage key={i} kind="property" src={rest[i] ? photoUrl(rest[i].name, 800) : null} alt={`${p.name} photo ${i + 2}`} className="hidden rounded-[24px] md:block" />
        ))}
      </div>
      <div className="mt-10 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="flex items-center justify-between gap-3">
            <PolicyBadge status={p.policyStatus} size="md" />
            <SaveButton refId={`place:${p.placeId}`} label={p.name} detail={p.formattedAddress} />
          </div>
          <h1 className="mt-4 text-[34px] font-semibold leading-tight tracking-[-0.02em] text-navy-900 sm:text-[42px]">{p.name}</h1>
          <p className="mt-2 flex items-center gap-2 text-[15px] text-charcoal/70">
            <PinIcon size={17} className="text-gold-600" /> {p.formattedAddress}
          </p>
          <p className="mt-6 max-w-[640px] text-[15.5px] leading-[1.75] text-charcoal/80">
            {p.summary ?? 'Contact the leasing office for current availability and screening requirements.'}
          </p>
          <div className="mt-8 rounded-[24px] border border-stone bg-white p-6">
            <h2 className="text-[17px] font-semibold text-navy-900">Rental policy</h2>
            <p className="mt-2 text-[14px] text-charcoal/75">{POLICY_LEVELS[p.policyStatus].description}</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[24px] border border-stone bg-white p-5 text-[14px]">
              <p className="text-stone-500">Pricing</p>
              <p className="mt-1 font-semibold text-charcoal">{p.pricing ? `${p.pricing.text} · ${p.pricing.source}` : 'Unconfirmed — contact for current pricing.'}</p>
            </div>
            <div className="rounded-[24px] border border-stone bg-white p-5 text-[14px]">
              <p className="text-stone-500">Availability</p>
              <p className="mt-1 font-semibold text-charcoal">Unconfirmed — contact the leasing office.</p>
            </div>
          </div>
        </div>
        <aside className="h-fit space-y-3 rounded-[24px] bg-white p-6 shadow-card lg:sticky lg:top-24">
          <h2 className="text-[17px] font-semibold text-navy-900">Contact leasing office</h2>
          {p.phone ? <LinkButton href={telHref(p.phone)} className="w-full" icon={<PhoneIcon size={17} />}>Call {p.phone}</LinkButton> : <p className="text-[14px] text-charcoal/65">No phone number listed.</p>}
          <LinkButton href={directionsUrl(p)} target="_blank" rel="noopener noreferrer" variant="outline-dark" className="w-full" icon={<RouteIcon size={17} />}>Get Directions</LinkButton>
          {p.website ? <LinkButton href={p.website} target="_blank" rel="noopener noreferrer" variant="outline-dark" className="w-full" icon={<GlobeIcon size={17} />}>Official website</LinkButton> : null}
        </aside>
      </div>
    </motion.div>
  );
}
