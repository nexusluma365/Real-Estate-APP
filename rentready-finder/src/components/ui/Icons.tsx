import type { ReactNode, SVGProps } from 'react';

/** Thin-line icon set (1.25px stroke) to match the reference's refined iconography. */
type P = SVGProps<SVGSVGElement> & { size?: number };
const S = ({ size = 24, children, ...rest }: P & { children: ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const BuildingIcon = (p: P) => (
  <S {...p}>
    <path d="M4 21V5.5L11 3v18M11 8h9v13M2.5 21h19" />
    <path d="M6.5 7.5h2M6.5 10.5h2M6.5 13.5h2M6.5 16.5h2M14 11.5h3M14 14.5h3M14 17.5h3" />
  </S>
);
export const KeyIcon = (p: P) => (
  <S {...p}>
    <circle cx="8" cy="15" r="4.25" />
    <path d="M11 12l9-9M16.5 6.5l2.5 2.5M14 9l2 2" />
  </S>
);
export const HouseIcon = (p: P) => (
  <S {...p}>
    <path d="M3 10.5L12 3.5l9 7" />
    <path d="M5.5 9v11.5h13V9" />
    <path d="M10 20.5v-6h4v6" />
  </S>
);
export const SearchIcon = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </S>
);
export const PinIcon = (p: P) => (
  <S {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </S>
);
export const PhoneIcon = (p: P) => (
  <S {...p}>
    <path d="M5 3.5h3.2l1.6 4-2 1.3a11 11 0 0 0 5.4 5.4l1.3-2 4 1.6V17a2.5 2.5 0 0 1-2.5 2.5A15 15 0 0 1 2.5 6 2.5 2.5 0 0 1 5 3.5z" />
  </S>
);
export const RouteIcon = (p: P) => (
  <S {...p}>
    <path d="M12 3l9 9-9 9-9-9 9-9z" />
    <path d="M9.5 13.5v-2a1.5 1.5 0 0 1 1.5-1.5h3.5M13 8l2 2-2 2" />
  </S>
);
export const GlobeIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z" />
  </S>
);
export const ShieldCheckIcon = (p: P) => (
  <S {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6L12 3z" />
    <path d="M8.75 12.25l2.25 2.25 4.25-4.5" />
  </S>
);
export const TargetIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
  </S>
);
export const CheckIcon = (p: P) => (
  <S {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </S>
);
export const ArrowRightIcon = (p: P) => (
  <S {...p}>
    <path d="M4.5 12h15M14 6.5l5.5 5.5-5.5 5.5" />
  </S>
);
export const ArrowLeftIcon = (p: P) => (
  <S {...p}>
    <path d="M19.5 12h-15M10 6.5L4.5 12l5.5 5.5" />
  </S>
);
export const LocateIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="6.5" />
    <circle cx="12" cy="12" r="2" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
  </S>
);
export const SlidersIcon = (p: P) => (
  <S {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </S>
);
export const InfoIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.75v.01" />
  </S>
);
export const MenuIcon = (p: P) => (
  <S {...p}>
    <path d="M4 7.5h16M4 12h16M4 16.5h16" />
  </S>
);
export const CloseIcon = (p: P) => (
  <S {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </S>
);
export const ImageOffIcon = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
    <path d="M3.5 16l4.5-4.5 3.5 3.5 3-3 6 5.5" />
    <circle cx="15.5" cy="9.5" r="1.4" />
  </S>
);
export const MailIcon = (p: P) => (
  <S {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
    <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
  </S>
);
export const LockIcon = (p: P) => (
  <S {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5" />
  </S>
);
export const HeartIcon = ({ filled, ...p }: P & { filled?: boolean }) => (
  <S {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />
  </S>
);
export const SparkIcon = (p: P) => (
  <S {...p}>
    <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z" />
  </S>
);
export const BellIcon = (p: P) => (
  <S {...p}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />
  </S>
);
export const UserIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </S>
);
