import { Reveal } from '../ui/Reveal';
import { Button } from '../ui/Button';
import { SmartImage } from '../ui/SmartImage';
import { ShieldCheckIcon, TargetIcon } from '../ui/Icons';
import { MEDIA } from '../../config/media';
import { useFinder } from '../../context/FinderContext';

export function AboutSection() {
  const { goTo } = useFinder();
  return (
    <section id="about" aria-labelledby="about-title" className="py-20 md:py-24">
      <div className="container-site">
        <Reveal>
          <div className="grid items-center gap-8 rounded-[34px] bg-white p-4 shadow-card ring-1 ring-black/[0.03] md:grid-cols-[1.05fr_1fr] md:gap-12 md:p-5">
            <SmartImage src={MEDIA.about.src} srcSet={MEDIA.about.srcSet} sizes="(min-width: 768px) 560px, 100vw" alt={MEDIA.about.alt} className="aspect-[4/3] rounded-[28px] md:aspect-auto md:h-full md:min-h-[420px]" />
            <div className="px-3 pb-6 md:px-0 md:py-8 md:pr-10">
              <p className="eyebrow">Why RentReady Finder</p>
              <h2 id="about-title" className="mt-3 text-[32px] font-extrabold leading-[1.08] tracking-[-0.03em] text-navy-900 sm:text-[40px]">
                Finding a Home Shouldn’t Feel Impossible.
              </h2>
              <p className="mt-5 max-w-[470px] text-[15.5px] leading-[1.75] text-charcoal/75">
                Every renter’s situation is different. RentReady Finder helps you explore real apartment communities, discover useful property information, and
                better understand your rental options.
              </p>
              <div className="mt-7 grid gap-5 sm:grid-cols-2">
                <div className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-700 text-white"><TargetIcon size={17} /></span>
                  <div>
                    <h3 className="text-[14.5px] font-bold text-navy-900">Real Property Information</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-charcoal/65">Discover properties using connected location data.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-700 text-white"><ShieldCheckIcon size={17} /></span>
                  <div>
                    <h3 className="text-[14.5px] font-bold text-navy-900">Clear Rental Policy Labels</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-charcoal/65">Know when screening requirements are verified or still unknown.</p>
                  </div>
                </div>
              </div>
              <Button className="mt-8" onClick={() => goTo('search', { focusSearch: true })}>
                Start Exploring
              </Button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
