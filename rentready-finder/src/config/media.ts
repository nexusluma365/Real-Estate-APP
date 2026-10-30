/**
 * Editorial (brand) photography — NOT property photos.
 * These are generic residential-architecture images used for atmosphere only and are never
 * presented as a specific live property. Source: Unsplash (Unsplash License, free for commercial use).
 * Swap for RentReady-owned photography before launch by editing this file.
 *
 * Every image has a graceful fallback (navy gradient) if it fails to load.
 */
const u = (id: string, w: number) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;
/** Width-described sources for srcset (the browser picks the smallest that fits the screen). */
const set = (id: string, widths: number[]) => widths.map((w) => `${u(id, w)} ${w}w`).join(', ');

export const MEDIA = {
  hero: {
    src: u('photo-1545324418-cc1a3fa10c00', 1600),
    srcSet: set('photo-1545324418-cc1a3fa10c00', [640, 960, 1600, 2200]),
    alt: 'Modern residential apartment building with balconies',
    credit: 'Unsplash',
  },
  about: {
    src: u('photo-1460317442991-0ec209397118', 1000),
    srcSet: set('photo-1460317442991-0ec209397118', [600, 1000, 1400]),
    alt: 'Contemporary apartment buildings against a clear sky',
    credit: 'Unsplash',
  },
  /** Atmosphere photos for the "Find Your Way Home" cards. Not property photos. */
  preview: [
    { src: u('photo-1486406146926-c627a92ad1ab', 700), srcSet: set('photo-1486406146926-c627a92ad1ab', [480, 700, 900]), alt: 'Glass residential tower' },
    { src: u('photo-1512917774080-9991f1c4c750', 700), srcSet: set('photo-1512917774080-9991f1c4c750', [480, 700, 900]), alt: 'Modern residence at dusk' },
    { src: u('photo-1580587771525-78b9dba3b914', 700), srcSet: set('photo-1580587771525-78b9dba3b914', [480, 700, 900]), alt: 'Contemporary residential exterior' },
  ],
} as const;
