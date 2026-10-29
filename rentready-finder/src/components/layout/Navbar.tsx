import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import { Logo } from './Logo';
import { ArrowLeftIcon, CloseIcon, LockIcon, MenuIcon, UserIcon } from '../ui/Icons';
import { useMember } from '../../context/MemberContext';
import { useFinder, type SectionId } from '../../context/FinderContext';

/** The RentReady sales site lives at the domain root; Finder is served under /finder, so this is a full page load. */
const RENTREADY_HOME = '/';

const LINKS: { label: string; action: 'home' | 'find' | 'second' | SectionId }[] = [
  { label: 'Home', action: 'home' },
  { label: 'Find Apartments', action: 'find' },
  { label: 'Second-Chance Options', action: 'second' },
  { label: 'How It Works', action: 'how-it-works' },
];

export function Navbar() {
  const { goTo, activateSecondChance } = useFinder();
  const { premium, openOffer } = useMember();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const solid = scrolled || pathname !== '/';

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const run = (a: (typeof LINKS)[number]['action'] | 'contact') => {
    setOpen(false);
    if (a === 'home') goTo('top');
    else if (a === 'find') goTo('search', { focusSearch: true });
    else if (a === 'second') activateSecondChance();
    else goTo(a as SectionId);
  };

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,box-shadow,backdrop-filter] duration-300 ease-lux ${
        solid ? 'bg-[#0E1522]/80 shadow-[0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl' : 'bg-transparent'
      }`}
    >
      <nav aria-label="Primary" className={`container-site flex items-center justify-between transition-[height] duration-300 ${solid ? 'h-[68px]' : 'h-[84px]'}`}>
        <button type="button" onClick={() => run('home')} className="rounded-sm" aria-label="RentReady Finder home">
          <Logo />
        </button>

        <ul className="hidden items-center gap-8 lg:flex">
          <li>
            <a href={RENTREADY_HOME} className="flex items-center gap-1.5 py-2 text-[12.5px] font-medium text-white/60 transition-colors duration-200 hover:text-gold">
              <ArrowLeftIcon size={14} />
              Back to RentReady
            </a>
          </li>
          {LINKS.map((l) => (
            <li key={l.label}>
              <button
                type="button"
                onClick={() => run(l.action)}
                className="group relative py-2 text-[13.5px] font-medium text-white/85 transition-colors duration-200 hover:text-white"
              >
                {l.label}
                <span className="absolute inset-x-0 -bottom-0.5 h-px origin-left scale-x-0 bg-gold transition-transform duration-300 ease-lux group-hover:scale-x-100" />
              </button>
            </li>
          ))}
          <li>
            {premium.active ? (
              <a href="/account" className="flex items-center gap-1.5 py-2 text-[13.5px] font-medium text-white/85 hover:text-white"><UserIcon size={16} /> My account</a>
            ) : (
              <button type="button" onClick={() => openOffer('', 'nav')} className="flex items-center gap-1.5 py-2 text-[13.5px] font-semibold text-gold hover:text-white"><LockIcon size={15} /> Premium</button>
            )}
          </li>
          <li>
            <button
              type="button"
              onClick={() => run('contact')}
              className="h-9 rounded-full border border-white/30 bg-white/10 px-5 backdrop-blur-md text-[13.5px] font-semibold text-white transition-colors duration-200 hover:border-gold hover:bg-gold hover:text-navy-900"
            >
              Contact
            </button>
          </li>
        </ul>

        <button
          type="button"
          className="-mr-2 p-2 text-white lg:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <CloseIcon size={26} /> : <MenuIcon size={26} />}
        </button>
      </nav>

      <AnimatePresence>
        {open ? (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
            className="fixed inset-x-0 bottom-0 top-[68px] bg-navy-900 lg:hidden"
          >
            <ul className="container-site flex flex-col pt-6">
              {[...LINKS, { label: 'Contact', action: 'contact' as const }].map((l) => (
                <li key={l.label} className="border-b border-white/10">
                  <button type="button" onClick={() => run(l.action)} className="flex w-full items-center justify-between py-5 text-left text-[18px] font-medium text-white">
                    {l.label}
                    <span className="h-px w-6 bg-gold" />
                  </button>
                </li>
              ))}
              <li className="border-b border-white/10">
                {premium.active ? (
                  <a href="/account" className="flex w-full items-center justify-between py-5 text-[18px] font-medium text-white">My account <UserIcon size={20} /></a>
                ) : (
                  <button type="button" onClick={() => { setOpen(false); openOffer('', 'nav_mobile'); }} className="flex w-full items-center justify-between py-5 text-left text-[18px] font-semibold text-gold">
                    RentReady Premium <LockIcon size={20} />
                  </button>
                )}
              </li>
              <li>
                <a href={RENTREADY_HOME} className="flex items-center gap-2 py-5 text-[15px] font-medium text-white/65 hover:text-gold">
                  <ArrowLeftIcon size={16} />
                  Back to RentReady
                </a>
              </li>
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
