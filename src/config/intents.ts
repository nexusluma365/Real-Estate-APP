import type { HeroCopy } from './headlines';

/**
 * Google Ads message match. Each intent page reuses the same Landing template
 * with copy that mirrors the search. Add a new intent here + it is automatically routed.
 * Ad groups should point final URLs at these paths (UTMs/gclid are preserved).
 */
export interface Intent {
  slug: string;
  hero: HeroCopy;
  metaTitle: string;
  metaDescription: string;
  /** "Does this sound familiar?" lines, written in the searcher's own words */
  recognition: string[];
  /** FAQ ids promoted to the top for this intent */
  faqFirst: string[];
}

export const INTENTS: Intent[] = [
  {
    slug: 'apartment-with-bad-credit',
    hero: {
      id: 'intent-bad-credit',
      headline: ['Worried your credit could affect', 'the apartment you want?'],
      sub: 'Understand what’s on your reports, what a property may look at, and what you can work on before you apply.',
    },
    metaTitle: 'Renting an Apartment with Credit Concerns — Prepare Before You Apply | RentReady',
    metaDescription: 'Credit concerns don’t have to mean guessing. Learn what rental screening may consider and build a plan before your apartment application.',
    recognition: [
      'You can cover the rent, but you’re not sure what your credit report will say about you.',
      'You’ve heard different minimum scores from different people and don’t know which is true.',
      'You don’t want to pay another application fee without knowing where you stand.',
    ],
    faqFirst: ['minimum-score', 'collections'],
  },
  {
    slug: 'apartment-approval-requirements',
    hero: {
      id: 'intent-requirements',
      headline: ['Before you apply, understand what', 'rental screening may consider.'],
      sub: 'Income, credit, rental history and documents — learn how properties commonly review an application, and prepare your side of it.',
    },
    metaTitle: 'Apartment Approval Requirements — What Screening May Consider | RentReady',
    metaDescription: 'Requirements vary by property. Learn what apartment screening commonly reviews and how to prepare your application before you apply.',
    recognition: [
      'Every listing seems to have different requirements, and some don’t list them at all.',
      'You want to know what will actually be reviewed before you hand over a fee.',
      'You’d rather prepare once than apply three times.',
    ],
    faqFirst: ['what-reviewed', 'minimum-score'],
  },
  {
    slug: 'apartment-application-denied',
    hero: {
      id: 'intent-denied',
      headline: ['Denied for an apartment?', 'Understand what to review before applying again.'],
      sub: 'A denial usually comes with information you can use. Learn what to request, what to check, and how to prepare for your next application.',
    },
    metaTitle: 'Apartment Application Denied? What to Review Before Applying Again | RentReady',
    metaDescription: 'If your apartment application was denied, you may have the right to know why. Learn what to review and how to prepare before you apply again.',
    recognition: [
      'You were denied and the reason was vague — or you never got one.',
      'You’re not sure whether it was your credit, your income, or something else.',
      'You don’t want the next application to end the same way.',
    ],
    faqFirst: ['denied', 'collections'],
  },
  {
    slug: 'apartment-credit-requirements',
    hero: {
      id: 'intent-credit-req',
      headline: ['What credit score do you need', 'for an apartment?'],
      sub: 'There is no single number. Learn how properties commonly use credit, find out what’s on your reports, and prepare before you apply.',
    },
    metaTitle: 'Apartment Credit Requirements — There’s No Single Number | RentReady',
    metaDescription: 'Apartment credit requirements vary by property. Learn how credit is commonly used in rental screening and what to review before applying.',
    recognition: [
      'You’ve searched for “minimum credit score for an apartment” and found five different answers.',
      'Your score is close to a number you’ve seen, and you can’t tell if that’s good enough.',
      'You want to know what you can work on in the time you have.',
    ],
    faqFirst: ['minimum-score', 'what-reviewed'],
  },
  {
    slug: 'rent-with-collections',
    hero: {
      id: 'intent-collections',
      headline: ['Renting with a collection', 'on your report?'],
      sub: 'Collections may matter to some properties more than others. Learn what to review, what you can verify, and how to prepare your application.',
    },
    metaTitle: 'Renting an Apartment with Collections on Your Credit Report | RentReady',
    metaDescription: 'A collection account doesn’t automatically decide an application, but it may be reviewed. Learn what to check and how to prepare.',
    recognition: [
      'There’s a collection on your report and you’re not sure it’s even accurate.',
      'You don’t know whether a property will care about a small or medical collection.',
      'You want a plan before you apply, not after.',
    ],
    faqFirst: ['collections', 'accurate'],
  },
  {
    slug: 'first-apartment',
    hero: {
      id: 'intent-first',
      headline: ['Applying for your', 'first apartment?'],
      sub: 'No rental history doesn’t mean no chance. Learn what properties may ask first-time renters for, and prepare your application with confidence.',
    },
    metaTitle: 'Applying for Your First Apartment — What to Prepare | RentReady',
    metaDescription: 'First apartment? Learn what rental screening may consider without rental history, what documents to gather, and how to prepare.',
    recognition: [
      'You’ve never had a lease in your name and don’t know what they’ll ask for.',
      'You have income, but not much credit history yet.',
      'You want to know whether a co-signer or guarantor might come up.',
    ],
    faqFirst: ['first-time', 'what-reviewed'],
  },
  {
    slug: 'rental-screening',
    hero: {
      id: 'intent-screening',
      headline: ['What do landlords look at', 'when you apply?'],
      sub: 'See your application the way a screening process may see it — income, credit, rental history and documents — and prepare your side first.',
    },
    metaTitle: 'Tenant Screening Explained — What Landlords May Review | RentReady',
    metaDescription: 'Learn what tenant screening commonly includes, what reports may show, and how to prepare your rental application before you apply.',
    recognition: [
      'You know there’s a background and credit check, but not what they’re really reviewing.',
      'You’ve wondered what a screening report says about you.',
      'You want to understand the process before you’re in the middle of it.',
    ],
    faqFirst: ['what-reviewed', 'screening-report'],
  },
];

export const INTENT_BY_SLUG = Object.fromEntries(INTENTS.map((i) => [i.slug, i]));
