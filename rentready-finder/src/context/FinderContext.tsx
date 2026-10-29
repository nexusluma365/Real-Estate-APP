import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DEFAULT_FILTERS, type SearchFilters } from '../types/property';

export type SectionId = 'top' | 'search' | 'second-chance' | 'how-it-works' | 'about' | 'featured' | 'contact';

interface FinderState {
  filters: SearchFilters;
  setFilters: (f: SearchFilters | ((prev: SearchFilters) => SearchFilters)) => void;
  secondChanceMode: boolean;
  /** Turns on the second-chance discovery filter, reveals the verification levels, and scrolls to search. */
  activateSecondChance: () => void;
  clearSecondChance: () => void;
  goTo: (id: SectionId, opts?: { focusSearch?: boolean }) => void;
}

const Ctx = createContext<FinderState | null>(null);

function scrollToId(id: SectionId, focusSearch?: boolean) {
  // Wait a frame so any state-driven layout change (e.g. the second-chance panel) has rendered.
  requestAnimationFrame(() => {
    const el = id === 'top' ? null : document.getElementById(id);
    if (id !== 'top' && !el) return;
    const navOffset = 72;
    const top = el ? el.getBoundingClientRect().top + window.scrollY - navOffset : 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
    if (!focusSearch) return;
    // Focus only once scrolling has finished — focusing mid-scroll cancels smooth scrolling in some browsers.
    let done = false;
    const focus = () => {
      if (done) return;
      done = true;
      window.removeEventListener('scrollend', focus);
      document.getElementById('location-input')?.focus({ preventScroll: true });
    };
    window.addEventListener('scrollend', focus, { once: true });
    window.setTimeout(focus, 1100);
  });
}

export function FinderProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<SearchFilters>(DEFAULT_FILTERS);
  const navigate = useNavigate();
  const location = useLocation();

  const goTo = useCallback(
    (id: SectionId, opts?: { focusSearch?: boolean }) => {
      if (location.pathname !== '/') {
        navigate('/');
        // wait for the home route to mount
        window.setTimeout(() => scrollToId(id, opts?.focusSearch), 80);
      } else {
        scrollToId(id, opts?.focusSearch);
      }
    },
    [location.pathname, navigate],
  );

  const activateSecondChance = useCallback(() => {
    setFilters((f) => ({ ...f, secondChance: f.secondChance === 'any' ? 'verified' : f.secondChance }));
    // Let the verification panel mount before scrolling so the scroll target is measured correctly.
    window.setTimeout(() => goTo('search', { focusSearch: true }), 60);
  }, [goTo]);

  const clearSecondChance = useCallback(() => setFilters((f) => ({ ...f, secondChance: 'any' })), []);

  const value = useMemo<FinderState>(
    () => ({
      filters,
      setFilters,
      secondChanceMode: filters.secondChance !== 'any',
      activateSecondChance,
      clearSecondChance,
      goTo,
    }),
    [filters, activateSecondChance, clearSecondChance, goTo],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFinder() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFinder must be used inside FinderProvider');
  return v;
}
