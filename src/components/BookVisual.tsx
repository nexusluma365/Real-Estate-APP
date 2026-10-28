import bookWebp from '../assets/book/before-they-say-no-mockup.webp';
import bookWebpSm from '../assets/book/before-they-say-no-mockup-640.webp';
import bookPng from '../assets/book/before-they-say-no-mockup.png';

/**
 * The "Before They Say No™" product artwork, in one place.
 * To replace it (e.g. with a transparent 3D mockup), swap the imports above, update width/height,
 * and set `cutout: true` — the frame is dropped and the book floats on a drop shadow. No layout changes needed.
 */
export const BOOK_ART = {
  webp: bookWebp,
  webpSmall: bookWebpSm,
  fallback: bookPng,
  width: 986,
  height: 1596,
  /** false = the art is a photograph with its own background, so it gets a framed "hero shot" treatment. */
  cutout: true,
  alt: 'Before They Say No™ — The Rental Approval Playbook, by RentReady',
};

type Size = 'hero' | 'feature' | 'mid' | 'thumb';

const SIZES: Record<Size, string> = {
  hero: '(min-width: 1000px) 480px, 70vw',
  feature: '(min-width: 1000px) 460px, 70vw',
  mid: '240px',
  thumb: '140px',
};

export function BookVisual({ size = 'feature', eager = false, className = '' }: { size?: Size; eager?: boolean; className?: string }) {
  const mode = BOOK_ART.cutout ? 'bv-cutout' : 'bv-photo';
  return (
    <div className={`bv bv-${size} ${mode} ${className}`}>
      <picture>
        <source type="image/webp" srcSet={`${BOOK_ART.webpSmall} 640w, ${BOOK_ART.webp} ${BOOK_ART.width}w`} sizes={SIZES[size]} />
        <img
          src={BOOK_ART.fallback}
          width={BOOK_ART.width}
          height={BOOK_ART.height}
          alt={BOOK_ART.alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding={eager ? 'sync' : 'async'}
          // React 18 only forwards the lowercase attribute
          {...(eager ? ({ fetchpriority: 'high' } as Record<string, string>) : {})}
        />
      </picture>
    </div>
  );
}
