import { motion } from 'motion/react';
import { SmartImage } from '../ui/SmartImage';
import { MEDIA } from '../../config/media';
import { Button } from '../ui/Button';
import { KeyIcon } from '../ui/Icons';
import { useFindSecondChance } from '../../hooks/useFindSecondChance';

const ease = [0.22, 0.61, 0.36, 1] as const;

/**
 * Compact full-bleed hero: headline + one line, so the search card (SearchSection, floating over its lower edge)
 * and the first results are visible without scrolling — cold search traffic came here to find apartments.
 */
export function Hero() {
  const findSecondChance = useFindSecondChance();
  return (
    <section id="top" aria-labelledby="hero-title" className="relative isolate flex min-h-[420px] items-center overflow-hidden">
      <motion.div className="absolute inset-0 -z-20" initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 2.4, ease }}>
        <SmartImage src={MEDIA.hero.src} srcSet={MEDIA.hero.srcSet} sizes="100vw" alt="" eager className="absolute inset-0 h-full w-full" />
      </motion.div>
      {/* Dusk grade: deep navy at the top-left for the headline, cooler and lighter toward the skyline */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(105deg,rgba(14,21,34,0.9)_0%,rgba(27,39,57,0.7)_38%,rgba(38,55,80,0.25)_72%,rgba(52,73,106,0.35)_100%)]" />
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-44 bg-gradient-to-b from-[#0E1522]/80 to-transparent" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-56 bg-gradient-to-t from-[#0E1522]/70 to-transparent" />

      <div className="container-site pb-44 pt-28 md:pb-48 md:pt-32">
        <div className="max-w-[640px]">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease, delay: 0.1 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-[12px] font-semibold tracking-[0.04em] text-white/85 backdrop-blur-md"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Apartment search · Screening information where available
          </motion.p>
          <motion.h1
            id="hero-title"
            initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.8, ease, delay: 0.18 }}
            className="max-w-[16ch] text-[36px] font-extrabold leading-[1.04] tracking-[-0.035em] text-white drop-shadow-[0_8px_30px_rgba(0,0,0,0.35)] sm:text-[52px] lg:text-[60px]"
          >
            Find Apartments That Fit Your Situation.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease, delay: 0.3 }}
            className="mt-4 max-w-[520px] text-[16px] leading-[1.6] text-white/80 sm:text-[17.5px]"
          >
            Search apartments near you. Explore listings and review screening information where available before you apply.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.4 }} className="mt-6">
            <Button size="lg" variant="glass" onClick={() => findSecondChance('hero')} icon={<KeyIcon size={18} />}>
              Find Second-Chance Apartments
            </Button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
