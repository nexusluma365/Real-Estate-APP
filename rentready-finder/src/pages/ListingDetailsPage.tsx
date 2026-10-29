import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { useMember } from '../context/MemberContext';
import { bathsLabel, bedsLabel, getListing, money, track, type RRListing } from '../services/member';
import { ListingCard, CLASS_LABEL } from '../components/property/ListingCard';
import { SaveButton } from '../components/property/SaveButton';
import { SmartImage } from '../components/ui/SmartImage';
import { Skeleton } from '../components/ui/Loader';
import { LinkButton } from '../components/ui/Button';
import { ArrowLeftIcon, GlobeIcon, PhoneIcon, PinIcon, ShieldCheckIcon } from '../components/ui/Icons';

type State = { kind: 'loading' } | { kind: 'ok'; l: RRListing } | { kind: 'missing' } | { kind: 'error' };
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null);

/** /listing/:id — a RentReady listing. Locked second-chance listings render the server's public fields only. */
export function ListingDetailsPage() {
  const { id = '' } = useParams();
  const { premium, recordView } = useMember();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    window.scrollTo(0, 0);
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    getListing(id, ctrl.signal)
      .then((d) => setState({ kind: 'ok', l: d.listing }))
      .catch((e) => !ctrl.signal.aborted && setState(e?.status === 404 ? { kind: 'missing' } : { kind: 'error' }));
    return () => ctrl.abort();
    // Re-fetch when membership changes (e.g. right after joining) so the details unlock in place.
  }, [id, premium.active]);

  useEffect(() => {
    if (state.kind !== 'ok') return;
    track('listing_view', { cta_location: state.l.locked ? 'listing_locked' : 'listing' });
    if (!state.l.locked) recordView(`listing:${state.l.listing_id}`, state.l.name, `${state.l.city}, ${state.l.state}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind === 'ok' && state.l.listing_id, state.kind === 'ok' && state.l.locked]);

  const back = sessionStorage.getItem('rr.finder.lastSearch') || '/';
  return (
    <div className="min-h-screen bg-offwhite pb-24 pt-[100px]">
      <div className="container-site">
        <Link to={back} className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-navy-700 hover:text-gold-700">
          <ArrowLeftIcon size={17} /> Back to search
        </Link>
        {state.kind === 'loading' ? (
          <div className="mt-6 grid gap-6 md:grid-cols-[1.4fr_1fr]" aria-busy="true"><Skeleton className="h-[380px] !rounded-[24px]" /><Skeleton className="h-[380px] !rounded-[24px]" /></div>
        ) : state.kind !== 'ok' ? (
          <div className="mt-6 rounded-[24px] bg-white p-8 text-center shadow-card">
            <h1 className="text-[22px] font-extrabold text-navy-900">{state.kind === 'missing' ? 'This listing is no longer available' : 'We couldn’t load this listing'}</h1>
            <p className="mt-2 text-[14.5px] text-charcoal/70">{state.kind === 'missing' ? 'It may have been leased or removed by its source.' : 'Please go back and try again.'}</p>
          </div>
        ) : state.l.locked ? (
          <div className="mx-auto mt-6 max-w-[440px]"><ListingCard l={state.l} /></div>
        ) : (
          <Full l={state.l} />
        )}
      </div>
    </div>
  );
}

function Full({ l }: { l: Extract<RRListing, { locked: false }> }) {
  const facts = [bedsLabel(l.beds), bathsLabel(l.baths)].filter(Boolean).join(' · ');
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mt-6 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
      <div>
        <SmartImage kind="property" eager src={l.photo_url} alt={l.name} className="aspect-[16/10] rounded-[26px]" />
        <div className="mt-8 flex items-start justify-between gap-4">
          <div>
            <span className={`rounded-full px-3 py-1 text-[12px] font-bold ${l.classification === 'verified_second_chance' ? 'bg-gold-100 text-gold-700' : 'bg-white text-navy-700'}`}>{CLASS_LABEL[l.classification]}</span>
            <h1 className="mt-4 text-[34px] font-extrabold leading-tight tracking-[-0.03em] text-navy-900 sm:text-[42px]">{l.name}</h1>
            <p className="mt-2 flex items-center gap-2 text-[15px] text-charcoal/70"><PinIcon size={17} className="text-gold-600" />{l.address ? `${l.address}, ` : ''}{l.city}, {l.state}</p>
          </div>
          <SaveButton refId={`listing:${l.listing_id}`} label={l.name} detail={`${l.city}, ${l.state}`} />
        </div>
        <p className="mt-5 text-[28px] font-extrabold tracking-[-0.02em] text-navy-900">
          {money(l.rent_cents) ?? 'Contact for pricing'}{l.rent_cents != null ? <span className="text-[15px] font-semibold text-charcoal/60"> /month advertised</span> : null}
        </p>
        {facts ? <p className="mt-1 text-[15px] text-charcoal/70">{facts}</p> : null}
        {l.description ? <p className="mt-6 max-w-[660px] whitespace-pre-line text-[15.5px] leading-[1.75] text-charcoal/80">{l.description}</p> : null}
        {l.screening_note ? (
          <div className="mt-8 rounded-[22px] border border-gold/40 bg-gold-100/50 p-6">
            <h2 className="flex items-center gap-2 text-[17px] font-extrabold text-navy-900"><ShieldCheckIcon size={19} className="text-gold-700" /> What the source says about screening</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-charcoal/85">{l.screening_note}</p>
            <p className="mt-3 text-[12.5px] text-charcoal/60">Policies change and each application is decided by the property. Confirm the current criteria with the leasing office before you pay an application fee.</p>
          </div>
        ) : null}
      </div>
      <aside className="h-fit space-y-3 rounded-[24px] bg-white p-6 shadow-card lg:sticky lg:top-24">
        <h2 className="text-[17px] font-extrabold text-navy-900">Contact the property</h2>
        {l.phone ? <LinkButton href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} className="w-full" icon={<PhoneIcon size={17} />}>Call {l.phone}</LinkButton> : <p className="text-[14px] text-charcoal/65">No phone number listed.</p>}
        {l.website ? <LinkButton href={l.website} target="_blank" rel="noopener noreferrer" variant="outline-dark" className="w-full" icon={<GlobeIcon size={17} />}>Property website</LinkButton> : null}
        <div className="border-t border-mist pt-4 text-[12.5px] leading-relaxed text-charcoal/65">
          <p>Source: <a href={l.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-navy-700 underline underline-offset-2">{l.source_name}</a></p>
          {l.verified_at ? <p>Last checked {date(l.verified_at)}</p> : null}
          <p className="mt-2">Pricing and availability can change. Always confirm with the leasing office.</p>
        </div>
      </aside>
    </motion.div>
  );
}
