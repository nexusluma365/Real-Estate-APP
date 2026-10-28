/**
 * Social proof architecture. Ships EMPTY and DISABLED.
 * Only add testimonials that are real, verified, and have written consent on file.
 * Results statements need a "results not typical / individual results vary" disclosure.
 */
export interface Testimonial {
  id: string;
  quote: string;
  name: string;
  context?: string;
  verified: boolean;
  consentOnFile: boolean;
  disclosure?: string;
}

export const SOCIAL_PROOF_ENABLED = false;
export const TESTIMONIALS: Testimonial[] = [];
