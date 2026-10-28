/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FUNNEL_MODE?: 'mock' | 'production';
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_SITE_URL?: string;
  readonly VITE_PHYSICAL_DELIVERY_NOTE?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  readonly VITE_HERO_VARIANT?: string;
  readonly VITE_GTM_ID?: string;
  readonly VITE_GA4_MEASUREMENT_ID?: string;
  readonly VITE_GOOGLE_ADS_ID?: string;
  readonly VITE_GOOGLE_ADS_LEAD_LABEL?: string;
  readonly VITE_GOOGLE_ADS_PURCHASE_LABEL?: string;
  readonly VITE_GOOGLE_ADS_UPSELL_LABEL?: string;
  readonly VITE_ANALYTICS_DEBUG?: string;
  readonly VITE_REQUIRE_EMAIL_CONSENT?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_MONEY_BACK_DAYS?: string;
  readonly VITE_PRIVACY_URL?: string;
  readonly VITE_TERMS_URL?: string;
  readonly VITE_REQUIRE_TRACKING_CONSENT?: string;
  readonly VITE_META_PIXEL_ID?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  Stripe?: (key: string) => unknown;
  fbq?: (...args: unknown[]) => void;
  _fbq?: unknown;
}
