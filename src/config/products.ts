import type { ProductId } from '../lib/types';

export interface Product {
  id: ProductId;
  name: string;
  shortName: string;
  priceCents: number;
  priceLabel: string;
  promise: string;
  /** What the buyer gets, in plain language */
  includes: string[];
  /** No longer sold (kept so past orders still display). The server refuses new purchases of these. */
  retired?: boolean;
}

/** The book, as titled on its cover. */
export const BOOK_TITLE = 'Know Before They Say NO!';

/** The three parts of the Complete Digital Bundle, in plain language (used on /creditready). */
export const BUNDLE_PARTS = [
  { title: 'Know Before They Say NO! — the digital eBook', body: 'What property managers and screening companies may look at, what may be hurting your chances, and how to prepare before you apply. A PDF you can read on any phone, tablet or computer.' },
  { title: '20 editable credit dispute letters', body: 'Ready-to-edit Microsoft Word letters for common situations — fill in your details, print, and send them yourself.' },
  { title: 'Video education guides', body: 'Walk you through how to dispute negative items you believe are inaccurate, incomplete or outdated, and how to use the letters.' },
] as const;

export const PLAYBOOK_CHAPTERS = [
  { title: 'The screening process', body: 'What commonly happens between “Submit” and a decision, and who may be involved.' },
  { title: 'Income qualification', body: 'How rent-to-income requirements are often written, and how to read a property’s criteria before you apply.' },
  { title: 'Credit considerations', body: 'What a screening report may show, and why the same score can be read differently by different properties.' },
  { title: 'Rental history', body: 'Landlord references, prior balances, and how past leases may come up.' },
  { title: 'Tenant screening reports', body: 'What tenant-screening companies may report, and your right to see and dispute that report.' },
  { title: 'Documentation', body: 'Pay stubs, offer letters, bank statements, 1099s and tax returns — what to gather for your situation.' },
  { title: 'Application red flags', body: 'Inconsistencies that can slow an application down, like mismatched income or missing addresses.' },
  { title: 'Questions to ask before you pay', body: 'What to ask the leasing office before you pay an application fee.' },
  { title: 'If you’re denied', body: 'Adverse action notices, how to request your screening report, and what to do before you apply again.' },
  { title: 'Your application game plan', body: 'A worksheet that pulls it together for the specific property you want.' },
] as const;

export const PRODUCTS: Record<ProductId, Product> = {
  // $79.99 — keeps the `creditready` id so existing orders and entitlements still work.
  creditready: {
    id: 'creditready',
    name: 'RentReady Complete Digital Bundle',
    shortName: 'Complete Digital Bundle',
    priceCents: 7999,
    priceLabel: '$79.99',
    promise: 'The eBook plus the tools to act on it — all digital.',
    includes: [
      'Know Before They Say NO! — the complete digital eBook (PDF)',
      '20 editable credit dispute letter templates (Microsoft Word)',
      'Video education guides showing how to dispute negative items',
    ],
  },
  // $39.99 — keeps the `guide` id so existing orders and entitlements still work.
  guide: {
    id: 'guide',
    name: 'RentReady Digital eBook',
    shortName: 'Digital eBook',
    priceCents: 3999,
    priceLabel: '$39.99',
    promise: 'Know Before They Say NO! — The Rental Approval Playbook, as a digital eBook.',
    includes: ['Know Before They Say NO! — the complete digital eBook (downloadable PDF)', 'Instant access after payment, plus a delivery email'],
  },
  // Retired (digital-only switch, 2026-11): no longer sold. Kept so past buyers' orders and access still display.
  playbook: {
    id: 'playbook',
    name: 'The Property Manager Playbook',
    shortName: 'Playbook',
    priceCents: 10000,
    priceLabel: '$100',
    promise: 'See your rental application from the other side of the desk.',
    includes: ['10-chapter guide to common rental screening considerations', 'Application game plan worksheet'],
    retired: true,
  },
  upgrade: {
    id: 'upgrade',
    name: 'RentReady Complete Digital Bundle (upgrade)',
    shortName: 'Bundle upgrade',
    priceCents: 4000,
    priceLabel: '$40',
    promise: 'Retired: book owners upgrading to the Bundle.',
    includes: ['20 editable credit dispute letter templates (Microsoft Word)', 'Video education guides'],
    retired: true,
  },
};

/** What each offer is for — used by checkout and the quiz result. */
export const OPTION_COPY: Record<'guide' | 'creditready', { bestFor: string; delivery: string; image: 'book' | 'bundle' }> = {
  guide: {
    bestFor: 'You want to understand what property managers may look at — and how to prepare — in one eBook.',
    delivery: 'Instant digital access after payment. No shipping, no waiting.',
    image: 'book',
  },
  creditready: {
    bestFor: 'You also want to act on what you learn: dispute letters to send and videos that walk you through it.',
    delivery: 'Everything unlocks right after payment and arrives in your inbox. No shipping, no waiting.',
    image: 'bundle',
  },
};

/** Analytics/ads values are reported in dollars. */
export const dollars = (cents: number) => cents / 100;
