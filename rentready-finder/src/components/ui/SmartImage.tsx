import { useState } from 'react';
import { ImageOffIcon } from './Icons';

interface SmartImageProps {
  src: string | null;
  alt: string;
  className?: string;
  imgClassName?: string;
  eager?: boolean;
  /** "editorial" falls back to a navy gradient; "property" shows the honest "Photo unavailable" placeholder. */
  kind?: 'editorial' | 'property';
  /** Responsive sources so phones never download desktop-sized photos. */
  srcSet?: string;
  sizes?: string;
}

/** Lazy-loaded image with a subtle fade-in and a graceful fallback. Reserves space to avoid layout shift. */
export function SmartImage({ src, alt, className = '', imgClassName = '', eager = false, kind = 'editorial', srcSet, sizes }: SmartImageProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>(src ? 'loading' : 'error');

  return (
    <div className={`${/\babsolute\b/.test(className) ? '' : 'relative'} overflow-hidden ${kind === 'editorial' ? 'img-fallback' : 'bg-stone'} ${className}`}>
      {src && state !== 'error' ? (
        <img
          src={src}
          srcSet={srcSet}
          sizes={srcSet ? sizes : undefined}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          // @ts-expect-error fetchpriority is valid HTML, not yet in React 18 types
          fetchpriority={eager ? 'high' : 'auto'}
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
          className={`h-full w-full object-cover transition-opacity duration-500 ease-lux ${state === 'loaded' ? 'opacity-100' : 'opacity-0'} ${imgClassName}`}
        />
      ) : null}
      {state === 'error' && kind === 'property' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stone-500">
          <ImageOffIcon size={28} />
          <span className="text-[12px] font-semibold uppercase tracking-[0.16em]">Photo unavailable</span>
        </div>
      ) : null}
      {state === 'error' && kind === 'editorial' ? <EditorialFallback /> : null}
    </div>
  );
}

/** Abstract architectural line drawing so a failed editorial image still looks intentional. */
function EditorialFallback() {
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 500" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3A5175" />
          <stop offset="0.65" stopColor="#5E6F88" />
          <stop offset="1" stopColor="#C9A877" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect width="800" height="500" fill="url(#sky)" />
      <g fill="#1B2739">
        <rect x="300" y="110" width="150" height="390" />
        <rect x="460" y="190" width="120" height="310" />
        <rect x="200" y="250" width="90" height="250" />
        <rect x="590" y="260" width="80" height="240" />
      </g>
      <g fill="#E8C98F" opacity="0.75">
        {Array.from({ length: 11 }).map((_, r) =>
          Array.from({ length: 5 }).map((__, c) => (
            <rect key={`${r}-${c}`} x={312 + c * 27} y={128 + r * 32} width="16" height="18" opacity={(r * 7 + c * 3) % 5 === 0 ? 0.25 : 1} />
          )),
        )}
        {Array.from({ length: 8 }).map((_, r) =>
          Array.from({ length: 4 }).map((__, c) => (
            <rect key={`b${r}-${c}`} x={472 + c * 27} y={208 + r * 34} width="15" height="18" opacity={(r + c) % 4 === 0 ? 0.3 : 0.9} />
          )),
        )}
      </g>
      <rect y="470" width="800" height="30" fill="#121B28" />
    </svg>
  );
}
