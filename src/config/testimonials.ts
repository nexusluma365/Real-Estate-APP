/**
 * Social proof architecture. Ships DISABLED, with empty placeholder slots.
 * Only publish testimonials that are real, verified, and have written consent on file (name, photo and quote).
 * Never write a quote, name, photo or rating here that a real customer didn't give you.
 * Results statements need a "results not typical / individual results vary" disclosure.
 *
 * To publish: fill in a slot's quote + name (first name and last initial), add `photo` and `rating` only if the customer
 * supplied them, set verified + consentOnFile to true, then set SOCIAL_PROOF_ENABLED = true.
 * Until then the home page shows CONCERNS instead — labeled as common concerns, never as reviews.
 */
export interface Testimonial {
  id: string;
  /** Bold headline for the card, in the customer's own words (or approved by them). */
  headline: string;
  quote: string;
  /** First name and last initial, e.g. "Danielle R." — with permission. */
  name: string;
  /** Approved customer photo: a URL or an imported image (put files in src/assets/testimonials/). */
  photo?: string;
  /** The customer's real star rating, if they gave one. Stars are shown only when this is set. */
  rating?: 1 | 2 | 3 | 4 | 5;
  context?: string;
  verified: boolean;
  consentOnFile: boolean;
  disclosure?: string;
}

export const SOCIAL_PROOF_ENABLED = false;

/** Six slots, one per theme. Headlines are suggestions — replace them with what the customer actually said. */
export const TESTIMONIALS: Testimonial[] = [
  { id: 'credit', headline: 'I Thought My Credit Would Stop Me.', quote: '', name: '', verified: false, consentOnFile: false },
  { id: 'denial', headline: 'Getting Denied Made Me Afraid to Apply Again.', quote: '', name: '', verified: false, consentOnFile: false },
  { id: 'fees', headline: 'I Was Tired of Paying Just to Hear No.', quote: '', name: '', verified: false, consentOnFile: false },
  { id: 'second-chance', headline: 'I Didn’t Know Where to Look.', quote: '', name: '', verified: false, consentOnFile: false },
  { id: 'history', headline: 'My Past Didn’t Have to Define My Next Step.', quote: '', name: '', verified: false, consentOnFile: false },
  { id: 'confidence', headline: 'For Once, I Felt More Prepared.', quote: '', name: '', verified: false, consentOnFile: false },
];

/** Testimonials that may be shown: switched on, verified, consented, and actually filled in. */
export const publishedTestimonials = () =>
  SOCIAL_PROOF_ENABLED ? TESTIMONIALS.filter((t) => t.verified && t.consentOnFile && t.quote.trim() && t.name.trim()) : [];

/**
 * Shown while there are no published testimonials: the worries renters bring to RentReady, each with what RentReady
 * actually offers for it. Presented as common concerns — no names, photos, quotes or ratings.
 */
export const CONCERNS: { id: string; icon: 'chart' | 'alert' | 'card' | 'compass' | 'doc' | 'shield'; worry: string; help: string }[] = [
  { id: 'credit', icon: 'chart', worry: 'Worried your credit will stop you?', help: 'Before They Say No™ explains what screening may look at — and how to review your credit report before you apply.' },
  { id: 'denial', icon: 'alert', worry: 'Denied before, and afraid to apply again?', help: 'Learn common reasons applications get turned down, and what to review and prepare before your next one.' },
  { id: 'fees', icon: 'card', worry: 'Tired of paying application fees just to hear no?', help: 'See what a property may look for before you pay. Premium shows published screening information when it’s available.' },
  { id: 'second-chance', icon: 'compass', worry: 'Not sure where to even look?', help: 'RentReady Finder lists verified second-chance apartments — properties whose own published policies consider imperfect histories.' },
  { id: 'history', icon: 'doc', worry: 'Feel like your past defines you?', help: 'The book walks through rental history, collections and screening, so you know what to prepare and what to ask.' },
  { id: 'confidence', icon: 'shield', worry: 'Want to feel prepared for once?', help: 'Use the free checklist — and, in the Digital Bundle, dispute letters and a video guide — to get ready before you apply.' },
];
