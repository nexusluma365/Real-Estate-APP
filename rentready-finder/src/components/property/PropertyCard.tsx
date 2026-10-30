import { Link } from 'react-router-dom';
import { SmartImage } from '../ui/SmartImage';
import { PolicyBadge } from './PolicyBadge';
import { SaveButton } from './SaveButton';
import { PhoneIcon, RouteIcon, ArrowRightIcon } from '../ui/Icons';
import { directionsUrl, photoUrl, telHref } from '../../services/api';
import type { Property } from '../../types/property';

const action =
  'inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full text-[12.5px] font-semibold transition-colors duration-200 ease-lux';

/** Live property card — renders ONLY data retrieved from the backend. Missing fields stay missing. */
export function PropertyCard({ p }: { p: Property }) {
  const photo = p.photos[0];
  const place = [p.neighborhood, p.city].filter(Boolean).join(', ');

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[26px] bg-white shadow-card ring-1 ring-black/[0.03] transition-[transform,box-shadow] duration-500 ease-lux hover:-translate-y-1.5 hover:shadow-float">
      <Link to={`/property/${encodeURIComponent(p.placeId)}`} className="block" tabIndex={-1} aria-hidden="true">
        <SmartImage
          kind="property"
          src={photo ? photoUrl(photo.name, 900) : null}
          alt={`${p.name} exterior`}
          className="aspect-[4/3]"
          imgClassName="transition-transform duration-[1200ms] ease-lux group-hover:scale-[1.06]"
        />
      </Link>
      <SaveButton refId={`place:${p.placeId}`} label={p.name} detail={p.formattedAddress} className="absolute right-3 top-3 z-10" />
      {photo?.attributions[0] ? (
        <p className="px-5 pt-2 text-[10.5px] text-stone-500">
          Photo:{' '}
          <a href={photo.attributions[0].uri} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
            {photo.attributions[0].displayName}
          </a>
        </p>
      ) : null}

      <div className="flex flex-1 flex-col px-5 pb-5 pt-4">
        <div className="mb-3">
          <PolicyBadge status={p.policyStatus} />
        </div>
        <h3 className="text-[19px] font-extrabold leading-snug tracking-[-0.02em] text-navy-900">
          <Link to={`/property/${encodeURIComponent(p.placeId)}`} className="hover:text-gold-700">
            {p.name}
          </Link>
        </h3>
        {place ? <p className="mt-1 text-[13px] font-medium text-gold-700">{place}</p> : null}
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-charcoal/70">{p.formattedAddress}</p>
        {p.summary ? <p className="mt-3 line-clamp-2 text-[13.5px] leading-relaxed text-charcoal/80">{p.summary}</p> : null}
        <dl className="mt-4 space-y-1.5 border-t border-mist pt-4 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-stone-500">Pricing</dt>
            <dd className="text-right font-medium text-charcoal">{p.pricing ? p.pricing.text : 'Contact for current pricing.'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-stone-500">Phone</dt>
            <dd className="text-right font-medium text-charcoal">{p.phone ?? 'Not listed'}</dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-col gap-2">
          <Link
            to={`/property/${encodeURIComponent(p.placeId)}`}
            className={`${action} w-full flex-none bg-navy-700 text-white hover:bg-navy-900`}
          >
            View Property <ArrowRightIcon size={15} />
          </Link>
          <div className="flex gap-2">
            {p.phone ? (
              <a href={telHref(p.phone)} className={`${action} bg-offwhite text-navy-700 hover:bg-navy-700 hover:text-white`}>
                <PhoneIcon size={15} /> Call Leasing Office
              </a>
            ) : (
              <span className={`${action} cursor-not-allowed bg-offwhite text-stone-500`} aria-disabled="true" title="No phone number listed">
                <PhoneIcon size={15} /> No phone listed
              </span>
            )}
            <a href={directionsUrl(p)} target="_blank" rel="noopener noreferrer" className={`${action} bg-offwhite text-navy-700 hover:bg-navy-700 hover:text-white`}>
              <RouteIcon size={15} /> Get Directions
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Phase A design-review card. Uses generic editorial photography and contains NO property data.
 * It is visibly labelled so it can never be mistaken for a live listing. Removed in Phase C.
 */
export function PreviewCard({ index }: { index: number }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[26px] bg-white shadow-card ring-1 ring-black/[0.03] transition-[transform,box-shadow] duration-500 ease-lux hover:-translate-y-1.5 hover:shadow-float">
      <div className="relative">
        {/* Deliberately no photo: a placeholder must never look like a real apartment. */}
        <SmartImage src={null} alt="" className="aspect-[4/3]" />
        <span className="absolute left-3 top-3 rounded-full bg-navy-900/80 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur-sm">
          Layout preview · Not a listing
        </span>
      </div>
      <div className="flex flex-1 flex-col px-5 pb-5 pt-5">
        <h3 className="text-[19px] font-extrabold tracking-[-0.02em] text-navy-900">Apartment community {index + 1}</h3>
        <p className="mt-1 text-[13.5px] text-charcoal/65">Live property name, address and photo load here</p>
        <div className="mt-4 space-y-2 border-t border-mist pt-4">
          <div className="h-3 w-3/4 rounded-[2px] bg-stone/80" />
          <div className="h-3 w-1/2 rounded-[2px] bg-stone/60" />
        </div>
      </div>
    </article>
  );
}
