import { env } from '../lib/env';

export const SITE = {
  brand: 'RentReady',
  domain: 'werentreadygo.com',
  url: env.siteUrl,
  supportEmail: env.supportEmail,
  privacyUrl: env.privacyUrl,
  termsUrl: env.termsUrl,
  /** The book is the hero product on the home page. */
  book: 'Before They Say No™',
  tagline: 'See before they see.',
  /** Short compliance line reused across pages. */
  disclaimer:
    'RentReady provides education and preparation tools based on information you provide. We are not a credit repair organization, a lender, a landlord, or a tenant-screening company. We do not guarantee apartment approval, credit score changes, or the removal of any information from your credit reports. Requirements vary by property.',
};
