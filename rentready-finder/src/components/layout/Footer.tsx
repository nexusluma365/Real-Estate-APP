import { Logo } from './Logo';
import { MailIcon } from '../ui/Icons';
import { useFinder } from '../../context/FinderContext';

export function Footer() {
  const { goTo, activateSecondChance } = useFinder();
  const link = 'text-[14px] text-white/70 transition-colors hover:text-gold';
  return (
    <footer id="contact" className="bg-navy-900 text-white">
      <div className="container-site grid gap-12 py-16 md:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-5 max-w-[340px] text-[14px] leading-relaxed text-white/65">
            Discover apartments near you, explore rental opportunities, and find properties that may work with your situation.
          </p>
        </div>
        <nav aria-label="Footer">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Explore</h2>
          <ul className="mt-5 space-y-3">
            <li><button type="button" className={link} onClick={() => goTo('search', { focusSearch: true })}>Find Apartments</button></li>
            <li><button type="button" className={link} onClick={activateSecondChance}>Second-Chance Options</button></li>
            <li><button type="button" className={link} onClick={() => goTo('how-it-works')}>How It Works</button></li>
          </ul>
        </nav>
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Contact</h2>
          <p className="mt-5 text-[14px] leading-relaxed text-white/70">Questions about RentReady Finder?</p>
          <a href="https://werentreadygo.com" className="mt-3 inline-flex items-center gap-2 text-[14px] font-semibold text-white hover:text-gold">
            <MailIcon size={18} /> Visit werentreadygo.com
          </a>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="container-site flex flex-col gap-2 py-6 text-[12px] text-white/50 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} RentReady. All rights reserved.</p>
          <p>Property information may change. Always confirm pricing, availability and screening policies with the leasing office.</p>
        </div>
      </div>
    </footer>
  );
}
