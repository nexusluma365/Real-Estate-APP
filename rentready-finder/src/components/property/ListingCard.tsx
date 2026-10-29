import { Link } from 'react-router-dom';
import { useMember } from '../../context/MemberContext';
import { bathsLabel, bedsLabel, money, track, type RRListing } from '../../services/member';
import { SmartImage } from '../ui/SmartImage';
import { ArrowRightIcon, LockIcon, ShieldCheckIcon } from '../ui/Icons';
import { SaveButton } from './SaveButton';

export const CLASS_LABEL: Record<RRListing['classification'], string> = {
  verified_second_chance: 'Verified second-chance',
  standard: 'Standard listing',
  unknown: 'Screening criteria unknown',
  unavailable: 'Temporarily unavailable',
};

const facts = (l: RRListing) => [bedsLabel(l.beds), bathsLabel(l.baths)].filter(Boolean).join(' · ');
// Verification dates are calendar dates (YYYY-MM-DD): format in UTC so they never shift a day.
const checked = (d: string | null) => (d ? `Verified ${new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}` : null);

/** A RentReady listing. Locked cards only ever receive public fields from the server. */
export function ListingCard({ l }: { l: RRListing }) {
  const { openOffer } = useMember();

  if (l.locked) {
    return (
      <article className="group relative flex flex-col overflow-hidden rounded-[26px] bg-white shadow-card ring-1 ring-gold/30 transition-[transform,box-shadow] duration-500 ease-lux hover:-translate-y-1.5 hover:shadow-float">
        <div className="relative aspect-[4/3] overflow-hidden bg-[linear-gradient(140deg,#34496A_0%,#263750_40%,#1B2739_100%)]">
          {/* No photo is sent for locked listings: this is an abstract, intentionally blurred placeholder. */}
          <span aria-hidden="true" className="absolute -left-10 top-6 h-40 w-40 rounded-full bg-gold/40 blur-3xl" />
          <span aria-hidden="true" className="absolute -right-6 bottom-0 h-44 w-44 rounded-full bg-[#9CC3DD]/30 blur-3xl" />
          <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-navy-900">
            <ShieldCheckIcon size={14} /> Premium
          </span>
          <span className="absolute inset-0 grid place-items-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white/15 text-white ring-1 ring-white/30 backdrop-blur-md"><LockIcon size={24} /></span>
          </span>
        </div>
        <div className="flex flex-1 flex-col p-5">
          <h3 className="text-[19px] font-extrabold tracking-[-0.02em] text-navy-900">Second-Chance Apartment</h3>
          <p className="mt-1 text-[13px] font-semibold text-gold-700">{l.city}, {l.state}</p>
          <p className="mt-3 text-[24px] font-extrabold tracking-[-0.02em] text-navy-900">
            {money(l.rent_cents) ?? 'Rent on request'}
            {l.rent_cents != null ? <span className="text-[14px] font-semibold text-charcoal/60"> /month</span> : null}
          </p>
          {facts(l) ? <p className="mt-1 text-[13.5px] text-charcoal/70">{facts(l)}</p> : null}
          <p className="mt-3 text-[12.5px] leading-relaxed text-charcoal/60">
            Name, address, contact and the published screening policy are included with Premium. {checked(l.verified_at)}.
          </p>
          <button
            type="button"
            onClick={() => {
              track('premium_unlock_click', { cta_location: 'listing_card', product: 'premium' });
              openOffer('See the name, address, contact details and screening policy for this apartment and every verified second-chance listing.', 'listing_card');
            }}
            className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-navy-700 text-[14px] font-bold text-white shadow-pill hover:bg-navy-900"
          >
            <LockIcon size={16} /> Unlock Access
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[26px] bg-white shadow-card ring-1 ring-black/[0.03] transition-[transform,box-shadow] duration-500 ease-lux hover:-translate-y-1.5 hover:shadow-float">
      <Link to={`/listing/${encodeURIComponent(l.listing_id)}`} tabIndex={-1} aria-hidden="true" className="relative block">
        <SmartImage kind="property" src={l.photo_url} alt="" className="aspect-[4/3]" imgClassName="transition-transform duration-[1200ms] ease-lux group-hover:scale-[1.06]" />
      </Link>
      <SaveButton refId={`listing:${l.listing_id}`} label={l.name} detail={`${l.city}, ${l.state}`} className="absolute right-3 top-3" />
      <div className="flex flex-1 flex-col p-5">
        <span className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${l.classification === 'verified_second_chance' ? 'bg-gold-100 text-gold-700' : 'bg-offwhite text-navy-700'}`}>
          {CLASS_LABEL[l.classification]}
        </span>
        <h3 className="mt-3 text-[19px] font-extrabold leading-snug tracking-[-0.02em] text-navy-900">
          <Link to={`/listing/${encodeURIComponent(l.listing_id)}`} className="hover:text-gold-700">{l.name}</Link>
        </h3>
        <p className="mt-1 text-[13px] text-charcoal/70">{l.address ? `${l.address}, ` : ''}{l.city}, {l.state}</p>
        <p className="mt-3 text-[22px] font-extrabold tracking-[-0.02em] text-navy-900">
          {money(l.rent_cents) ?? 'Contact for pricing'}
          {l.rent_cents != null ? <span className="text-[14px] font-semibold text-charcoal/60"> /month</span> : null}
        </p>
        {facts(l) ? <p className="mt-1 text-[13.5px] text-charcoal/70">{facts(l)}</p> : null}
        <p className="mt-3 text-[11.5px] text-stone-500">Source: {l.source_name}{l.verified_at ? ` · ${checked(l.verified_at)}` : ''}</p>
        <Link to={`/listing/${encodeURIComponent(l.listing_id)}`} className="mt-5 inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-offwhite text-[13.5px] font-bold text-navy-700 hover:bg-navy-700 hover:text-white">
          View details <ArrowRightIcon size={15} />
        </Link>
      </div>
    </article>
  );
}
