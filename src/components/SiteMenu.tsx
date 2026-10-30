import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { useFunnel } from '../state/FunnelContext';
import { memberState, openBillingPortal, signOut, type MemberState } from '../lib/memberService';

/** RentReady Finder is a separate app served by the same domain at /finder/ (see netlify.toml), so it's a full page load. */
export const FINDER_URL = '/finder/';

type Item = { label: string; hint: string } & ({ section: string } | { href: string } | { home: true } | { action: 'signout' | 'billing' });

/**
 * Menu by membership state (server-decided, see memberState): guests get Second-Chance + Sign In; members get My Account +
 * Sign Out; members with a failed payment also get Update Payment. The free Finder is always there.
 */
function menuItems(state: MemberState): Item[] {
  const base: Item[] = [
    { label: 'Home', hint: 'Back to the start', home: true },
    { label: 'RentReady Finder', hint: 'Search apartments near you', href: FINDER_URL },
    { label: 'Get the Book', hint: 'Before They Say No™ — the rental approval playbook', section: 'get' },
  ];
  const account: Item = { label: 'My Account', hint: state === 'active' ? 'Premium · Active' : state === 'past_due' ? 'Premium · Payment due' : 'Saved apartments, purchases and membership', href: '/account' };
  const signOut: Item = { label: 'Sign Out', hint: 'Sign out on this device', action: 'signout' };
  // Members go straight to second-chance listings; others see them locked, with the sign-up / sign-in offer.
  const secondChance: Item = { label: 'Find Second-Chance Apartments', hint: state === 'active' ? 'Verified second-chance listings' : 'Sign up or sign in to see full details', href: `${FINDER_URL}?mode=second-chance` };
  if (state === 'guest') return [...base, secondChance, { label: 'Sign In', hint: 'We’ll email you a secure link', href: '/account' }];
  if (state === 'active') return [...base, secondChance, account, signOut];
  if (state === 'past_due') return [...base, account, { label: 'Update Payment', hint: 'Securely update your card with Stripe', action: 'billing' }, signOut];
  if (state === 'lapsed') return [...base, account, { label: 'Reactivate Premium', hint: '$19.99/month · cancel any time', href: '/premium' }, signOut];
  return [...base, secondChance, account, signOut];
}

/**
 * Header menu (three-line toggle, top right) with a panel that slides in from the right beneath the header.
 * The panel is portalled to <body> because the header's backdrop-filter would otherwise contain a fixed child.
 */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(64);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { entitlements, refreshEntitlements } = useFunnel();
  const items = menuItems(memberState(entitlements));

  // Any route change (including the header's own links) closes the menu.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    setTop(Math.max(0, Math.round(toggleRef.current?.closest('header')?.getBoundingClientRect().bottom ?? 64)));
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const first = panelRef.current?.querySelector<HTMLElement>('a, button');
    const focusTimer = window.setTimeout(() => first?.focus({ preventScroll: true }), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (e.key !== 'Tab') return;
      // Keep focus cycling between the toggle and the menu links while the menu is open.
      const ring = [toggleRef.current, ...Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a, button') ?? [])].filter(Boolean) as HTMLElement[];
      const at = ring.indexOf(document.activeElement as HTMLElement);
      const next = at === -1 ? 0 : (at + (e.shiftKey ? -1 : 1) + ring.length) % ring.length;
      e.preventDefault();
      ring[next].focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const go = async (item: Item) => {
    setOpen(false);
    if ('action' in item) {
      if (item.action === 'billing') await openBillingPortal('/account').catch(() => navigate('/account'));
      else {
        await signOut();
        await refreshEntitlements();
        navigate('/');
      }
    } else if ('home' in item) {
      if (pathname === '/') window.scrollTo({ top: 0 });
      else navigate('/');
    } else if ('section' in item) {
      const el = document.getElementById(item.section);
      // Scroll once the scroll lock is released; off the home page, ScrollToTop handles the hash.
      if (el) requestAnimationFrame(() => el.scrollIntoView());
      else navigate(`/#${item.section}`);
    }
  };

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="rr-menu-toggle"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        aria-controls="rr-menu"
        data-open={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </button>
      {createPortal(
        <div className="rr-menu" data-open={open} style={{ ['--rr-menu-top' as string]: `${top}px` }}>
          <div className="rr-menu-scrim" onClick={() => setOpen(false)} aria-hidden="true" />
          <nav ref={panelRef} id="rr-menu" className="rr-menu-panel" aria-label="Site menu" aria-hidden={!open}>
            <ul>
              {items.map((item, i) => (
                <li key={item.label} style={{ ['--i' as string]: i }}>
                  {'href' in item ? (
                    <a className="rr-menu-link" href={item.href} tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>
                      <span className="rr-menu-label">{item.label}</span>
                      <span className="rr-menu-hint">{item.hint}</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="rr-menu-link"
                      tabIndex={open ? 0 : -1}
                      aria-current={'home' in item && pathname === '/' ? 'page' : undefined}
                      onClick={() => void go(item)}
                    >
                      <span className="rr-menu-label">{item.label}</span>
                      <span className="rr-menu-hint">{item.hint}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>,
        document.body,
      )}
    </>
  );
}
