import { env } from '../lib/env';
import { read, write } from '../lib/storage';

export interface HeroCopy {
  id: string;
  headline: [string, string?];
  sub: string;
}

/** A/B-ready hero variants. Select with ?v=<id>, VITE_HERO_VARIANT, or sticky random assignment. */
export const HERO_VARIANTS: HeroCopy[] = [
  {
    id: 'afford',
    headline: ['You can afford the apartment.', 'But is your application ready?'],
    sub: 'Understand your credit, learn what rental screening may consider, and prepare before applying for the apartment you actually want.',
  },
  {
    id: 'income',
    headline: ['Good income.', 'Credit concerns?'],
    sub: 'Income is one part of an application. Learn what else may be reviewed — and prepare before you pay a single application fee.',
  },
  {
    id: 'found',
    headline: ['Found the apartment you want?', 'Get ready before you apply.'],
    sub: 'Know what to prepare, understand what may be reviewed, and walk into your application with more information.',
  },
  {
    id: 'worried',
    headline: ['Worried your credit could', 'get in the way?'],
    sub: 'Find out what’s on your reports, what may matter to a property, and what you can work on before you apply.',
  },
];

/** Variants included in random assignment. Keep to the default until a test is running. */
const ACTIVE_TEST: string[] = ['afford'];

export function pickHeroVariant(search: string): HeroCopy {
  const fromUrl = new URLSearchParams(search).get('v');
  const byId = (id?: string | null) => HERO_VARIANTS.find((h) => h.id === id);
  const forced = byId(fromUrl) || byId(env.heroVariant);
  if (forced) return forced;
  const sticky = byId(read<string>('hero_variant', ''));
  if (sticky && ACTIVE_TEST.includes(sticky.id)) return sticky;
  const pick = ACTIVE_TEST[Math.floor(Math.random() * ACTIVE_TEST.length)];
  write('hero_variant', pick);
  return byId(pick) || HERO_VARIANTS[0];
}
