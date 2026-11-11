import type { ProductId } from '../lib/types';

export interface Product {
  id: ProductId;
  name: string;
  shortName: string;
  priceCents: number;
  priceLabel: string;
  promise: string;
  /** Includes a physical item, so checkout collects a shipping address. */
  ships?: boolean;
  /** Shipping charged on top of priceCents at checkout (must match SHIPPING in netlify/lib/_lib.ts). */
  shippingCents?: number;
  /** What the buyer gets, in plain language */
  includes: string[];
}

/** The three parts of the Digital Bundle, in plain language (used on /creditready). */
export const BUNDLE_PARTS = [
  { title: 'Before They Say No™ — the physical book', body: 'What property managers and screening companies may look at, what may be hurting your chances, and how to prepare before you apply. Mailed to you.' },
  { title: '20 Essential Credit Dispute Letter templates', body: 'Ready-to-edit Microsoft Word letters for common situations — fill in your details, print, and send them yourself.' },
  { title: 'Step-by-step video guide', body: 'Walks you through how to dispute negative items you believe are inaccurate, incomplete or outdated, and how to use the letters.' },
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
  // The RentReady Digital Bundle. Keeps the `creditready` id so existing orders, entitlements and the upsell still work.
  creditready: {
    id: 'creditready',
    name: 'RentReady Book + Digital Tools Bundle',
    shortName: 'Book + Digital Tools',
    priceCents: 7999,
    priceLabel: '$79.99',
    promise: 'The book plus the tools to act on it.',
    ships: true,
    shippingCents: 999,
    includes: [
      'Physical copy of Before They Say No™, mailed to you',
      '20 Essential Credit Dispute Letter templates — easy to edit in Microsoft Word',
      'Step-by-step video guide showing how to dispute negative items',
    ],
  },
  guide: {
    id: 'guide',
    name: 'Before They Say No™',
    shortName: 'The Book',
    priceCents: 3999,
    priceLabel: '$39.99',
    promise: 'The Rental Approval Playbook — the physical book, mailed to you.',
    ships: true,
    shippingCents: 999,
    includes: ['Physical copy of Before They Say No™ — The Rental Approval Playbook, mailed to you'],
  },
  playbook: {
    id: 'playbook',
    name: 'The Property Manager Playbook',
    shortName: 'Playbook',
    priceCents: 10000,
    priceLabel: '$100',
    promise: 'See your rental application from the other side of the desk.',
    includes: [
      '10-chapter guide to common rental screening considerations',
      'Three worked sample applications',
      'Questions to ask before paying an application fee',
      'Documentation checklist by employment type',
      'Denial and adverse action next-steps guide',
      'Property-specific application game plan worksheet',
    ],
  },
  // Book owners → Digital Bundle. Their $39.99 book price counts in full ($79.99 − $39.99 = $40; shipping isn't credited). They already have the
  // book, so nothing ships — the upgrade adds the letters and the video guide. Grants `creditready` on the server.
  upgrade: {
    id: 'upgrade',
    name: 'Upgrade to the RentReady Book + Digital Tools Bundle',
    shortName: 'Bundle upgrade',
    priceCents: 4000,
    priceLabel: '$40',
    promise: 'Your $39.99 book purchase counts in full toward the Digital Bundle.',
    includes: [
      '20 Essential Credit Dispute Letter templates — easy to edit in Microsoft Word',
      'Step-by-step video guide showing how to dispute negative items',
    ],
  },
};

/** What each front-door option is for — used by the landing comparison, checkout and the quiz result. */
export const OPTION_COPY: Record<'guide' | 'creditready', { bestFor: string; delivery: string; image: 'book' | 'bundle' }> = {
  guide: {
    bestFor: 'You want to understand what property managers may look at — and how to prepare — in one book.',
    delivery: 'Your physical copy ships to the address you enter at checkout.',
    image: 'book',
  },
  creditready: {
    bestFor: 'You also want to act on what you learn: dispute letters to send and videos that walk you through it.',
    delivery: 'Letters and videos unlock right after checkout. Your book ships to you.',
    image: 'bundle',
  },
};

export const UPGRADE_CREDIT_CENTS = 3999;

/** Shipping shown next to a product price, e.g. "+ $9.99 shipping" (empty when shipping is included). */
export const shippingLabel = (p: Product) => (p.shippingCents ? `+ $${(p.shippingCents / 100).toFixed(2)} shipping` : '');
/** What the buyer is actually charged: price + shipping (matches chargeCents() on the server). */
export const totalCents = (p: Product) => p.priceCents + (p.shippingCents ?? 0);
export const totalLabel = (p: Product) => (p.shippingCents ? `$${(totalCents(p) / 100).toFixed(2)}` : p.priceLabel);

export const BUNDLE_TOTAL_CENTS = PRODUCTS.creditready.priceCents + (PRODUCTS.creditready.shippingCents ?? 0) + PRODUCTS.playbook.priceCents;

/** Analytics/ads values are reported in dollars. */
export const dollars = (cents: number) => cents / 100;
