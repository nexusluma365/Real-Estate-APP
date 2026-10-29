import type { ReactNode } from 'react';
import { Reveal } from '../ui/Reveal';
import { SmartImage } from '../ui/SmartImage';
import { BuildingIcon, HouseIcon, KeyIcon, ArrowRightIcon } from '../ui/Icons';
import { MEDIA } from '../../config/media';
import { useFinder } from '../../context/FinderContext';

interface Card {
  title: string;
  kicker: string;
  body: string;
  icon: ReactNode;
  cta: string;
  image: { src: string; alt: string };
  onClick: () => void;
}

/** Three ways in. Photos are editorial atmosphere (config/media.ts), never presented as listings. */
export function FeatureCards() {
  const { goTo, activateSecondChance, clearSecondChance } = useFinder();

  const cards: Card[] = [
    {
      title: 'Explore Apartments',
      kicker: 'Any city, ZIP or address',
      body: 'Discover residential communities in your preferred city.',
      icon: <BuildingIcon size={16} />,
      cta: 'Start a search',
      image: MEDIA.preview[0],
      onClick: () => {
        clearSecondChance();
        goTo('search', { focusSearch: true });
      },
    },
    {
      title: 'Second-Chance Options',
      kicker: 'Evidence-based labels',
      body: 'Explore properties with published flexible screening or rental policies.',
      icon: <KeyIcon size={16} />,
      cta: 'See verification levels',
      image: MEDIA.preview[1],
      onClick: activateSecondChance,
    },
    {
      title: 'Find Your Fit',
      kicker: 'Distance, type and more',
      body: 'Search by location and explore property details.',
      icon: <HouseIcon size={16} />,
      cta: 'Set your filters',
      image: MEDIA.preview[2],
      onClick: () => {
        goTo('search', { focusSearch: true });
        window.dispatchEvent(new CustomEvent('rr:open-filters'));
      },
    },
  ];

  return (
    <section aria-labelledby="ways-title" className="pb-8 pt-20 md:pt-24">
      <div className="container-site">
        <Reveal>
          <h2 id="ways-title" className="section-title">
            Find Your Way Home
          </h2>
        </Reveal>
        <div className="mt-9 grid gap-6 md:grid-cols-3 md:gap-7">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.08}>
              <article className="group flex h-full flex-col overflow-hidden rounded-[26px] bg-white shadow-card ring-1 ring-black/[0.03] transition-[transform,box-shadow] duration-500 ease-lux hover:-translate-y-1.5 hover:shadow-float">
                <SmartImage src={c.image.src} alt={c.image.alt} className="aspect-[16/10]" imgClassName="transition-transform duration-[1200ms] ease-lux group-hover:scale-[1.06]" />
                <div className="flex flex-1 flex-col p-6">
                  <h3 className="text-[20px] font-extrabold tracking-[-0.02em] text-navy-900">{c.title}</h3>
                  <p className="mt-1 text-[12.5px] font-semibold text-gold-700">{c.kicker}</p>
                  <p className="mt-3 flex-1 text-[14px] leading-[1.65] text-charcoal/70">{c.body}</p>
                  <button
                    type="button"
                    onClick={c.onClick}
                    className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-offwhite px-4 py-2 text-[13px] font-bold text-navy-700 transition-colors duration-300 hover:bg-navy-700 hover:text-white"
                  >
                    {c.icon}
                    {c.cta}
                    <ArrowRightIcon size={14} className="transition-transform duration-300 group-hover:translate-x-0.5" />
                  </button>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
