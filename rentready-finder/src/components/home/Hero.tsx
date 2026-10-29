import { motion } from 'motion/react';
import { SmartImage } from '../ui/SmartImage';
import { Button } from '../ui/Button';
import { KeyIcon, SearchIcon } from '../ui/Icons';
import { MEDIA } from '../../config/media';
import { useFinder } from '../../context/FinderContext';

const ease = [0.22, 0.61, 0.36, 1] as const;

/** Full-bleed architecture hero; the search card (SearchSection) floats over its lower edge. */
export function Hero() {
  const { goTo, activateSecondChance } = useFinder();

  return (
    <section id="top" aria-labelledby="hero-title" className="relative isolate flex min-h-[660px] items-center overflow-hidden h-[88vh] max-h-[900px]">
      <motion.div className="absolute inset-0 -z-20" initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 2.4, ease }}>
        <SmartImage src={MEDIA.hero.src} alt="" eager className="absolute inset-0 h-full w-full" />
      </motion.div>
      {/* Dusk grade: deep navy at the top-left for the headline, cooler and lighter toward the skyline */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(105deg,rgba(14,21,34,0.9)_0%,rgba(27,39,57,0.7)_38%,rgba(38,55,80,0.25)_72%,rgba(52,73,106,0.35)_100%)]" />
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-44 bg-gradient-to-b from-[#0E1522]/80 to-transparent" />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-56 bg-gradient-to-t from-[#0E1522]/70 to-transparent" />

      <div className="container-site pb-44 pt-28 md:pb-48">
        <div className="max-w-[640px]">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease, delay: 0.1 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-[12px] font-semibold tracking-[0.04em] text-white/85 backdrop-blur-md"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Apartment discovery · Second-chance friendly
          </motion.p>
          <motion.h1
            id="hero-title"
            initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ duration: 0.8, ease, delay: 0.18 }}
            className="text-[46px] font-extrabold leading-[1.02] tracking-[-0.035em] text-white drop-shadow-[0_8px_30px_rgba(0,0,0,0.35)] sm:text-[64px] lg:text-[78px]"
          >
            Your Next Home
            <br />
            Starts Here.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease, delay: 0.3 }}
            className="mt-6 max-w-[500px] text-[16px] leading-[1.7] text-white/80 sm:text-[17.5px]"
          >
            Explore real apartment communities, discover rental opportunities, and take the next step toward finding a place to call home.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease, delay: 0.42 }}
            className="mt-9 flex flex-col gap-3 sm:flex-row sm:gap-4"
          >
            <Button size="lg" className="px-8 ring-1 ring-white/15" onClick={() => goTo('search', { focusSearch: true })} icon={<SearchIcon size={18} />}>
              Search Apartments
            </Button>
            <Button size="lg" variant="glass" onClick={activateSecondChance} icon={<KeyIcon size={18} />}>
              Find Second-Chance Options
            </Button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
