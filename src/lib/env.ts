/**
 * Central environment access. Only VITE_* values reach the browser,
 * so NOTHING secret may ever be read here. Secrets live in Netlify environment
 * variables read by the API function (see netlify/ and .env.example).
 */
export type FunnelMode = 'mock' | 'production';

const e = import.meta.env;

export const env = {
  mode: (e.VITE_FUNNEL_MODE === 'production' ? 'production' : 'mock') as FunnelMode,
  apiBase: (e.VITE_API_BASE_URL || '/api').replace(/\/$/, ''),
  siteUrl: (e.VITE_SITE_URL || 'https://werentreadygo.com').replace(/\/$/, ''),
  supportEmail: e.VITE_SUPPORT_EMAIL || 'support@werentreadygo.com',
  stripePublishableKey: e.VITE_STRIPE_PUBLISHABLE_KEY || '',
  heroVariant: e.VITE_HERO_VARIANT || '',
  gtmId: e.VITE_GTM_ID || '',
  ga4Id: e.VITE_GA4_MEASUREMENT_ID || '',
  googleAdsId: e.VITE_GOOGLE_ADS_ID || '',
  googleAdsLeadLabel: e.VITE_GOOGLE_ADS_LEAD_LABEL || '',
  googleAdsPurchaseLabel: e.VITE_GOOGLE_ADS_PURCHASE_LABEL || '',
  googleAdsUpsellLabel: e.VITE_GOOGLE_ADS_UPSELL_LABEL || '',
  analyticsDebug: e.VITE_ANALYTICS_DEBUG === 'true' || e.DEV,
  requireEmailConsent: e.VITE_REQUIRE_EMAIL_CONSENT === 'true',
  /** Show a cookie/tracking consent banner and keep ad + analytics storage denied until accepted. */
  requireTrackingConsent: e.VITE_REQUIRE_TRACKING_CONSENT === 'true',
  metaPixelId: e.VITE_META_PIXEL_ID || '',
  turnstileSiteKey: e.VITE_TURNSTILE_SITE_KEY || '',
  /** Book delivery estimate shown at checkout and in the FAQ (from your print/fulfillment partner). */
  physicalDeliveryNote: e.VITE_PHYSICAL_DELIVERY_NOTE || '',
  /** Privacy policy / terms URLs. Footer links render only when set. */
  privacyUrl: e.VITE_PRIVACY_URL || '',
  termsUrl: e.VITE_TERMS_URL || '',
  /** Money-back guarantee window in days. 0 hides every guarantee mention. */
  moneyBackDays: Math.max(0, Number.parseInt(e.VITE_MONEY_BACK_DAYS ?? '30', 10) || 0),
};

/** Mock mode simulates the backend locally. It is never allowed to grant real access. */
export const isMock = env.mode === 'mock';
