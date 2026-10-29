import { env } from './env';
import { getAttribution } from './attribution';
import { getSessionId } from './session';
import { read, write } from './storage';
import type { Lead, ProductId } from './types';
import { PRODUCTS, dollars } from '../config/products';

export type FunnelEvent =
  | 'landing_view'
  | 'primary_cta_click'
  | 'lead_started'
  | 'lead_captured'
  | 'consideration_view'
  | 'consideration_complete'
  | 'credit_offer_view'
  | 'credit_offer_cta'
  | 'checkout_view'
  | 'checkout_started'
  | 'credit_purchase_success'
  | 'credit_purchase_failed'
  | 'upsell_view'
  | 'upsell_accept_click'
  | 'upsell_decline_click'
  | 'upsell_purchase_success'
  | 'upsell_purchase_failed'
  | 'thankyou_view'
  | 'assessment_started'
  | 'assessment_step_completed'
  | 'assessment_completed'
  | 'gameplan_viewed'
  | 'product_download'
  | 'customer_returned'
  | 'share_clicked'
  | 'product_view'
  | 'options_view'
  | 'qualification_started'
  | 'qualification_step'
  | 'qualification_completed'
  | 'qualification_skipped'
  | 'faq_open'
  | 'exit_offer_shown'
  | 'exit_offer_click'
  | 'free_resource_view'
  | 'free_resource_requested'
  | 'upgrade_offer_view'
  | 'upgrade_purchase_success';

export interface EventProps {
  product?: ProductId | 'bundle' | 'premium';
  order_value?: number;
  revenue?: number;
  transaction_id?: string;
  cta_location?: string;
  step?: string;
  method?: string;
  variant?: string;
  reason?: string;
  resource?: string;
  /** Commercial-intent tier from the quiz (high | medium | early). Never answers, scores or income. */
  intent_tier?: string;
  recommended?: string;
}

/** Only these keys may leave the browser. Credit ranges, income, card data etc. are never allowed. */
const ALLOWED = new Set<keyof EventProps>([
  'product', 'order_value', 'revenue', 'transaction_id', 'cta_location', 'step', 'method', 'variant', 'reason', 'resource',
  'intent_tier', 'recommended',
]);

export interface EventPayload extends EventProps {
  event: FunnelEvent;
  lead_id?: string;
  session_id: string;
  customer_id?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  landing_intent?: string;
  page_path: string;
  ts: string;
}

let customerId: string | undefined;
export const setAnalyticsCustomer = (id?: string) => {
  customerId = id;
};

const debugLog: EventPayload[] = [];
export const getDebugEvents = () => debugLog.slice(-50);

export function track(event: FunnelEvent, props: EventProps = {}): EventPayload {
  const a = getAttribution();
  const lead = read<Lead | null>('lead', null);
  const safe: EventProps = {};
  for (const [k, v] of Object.entries(props)) {
    if (ALLOWED.has(k as keyof EventProps) && v !== undefined) (safe as Record<string, unknown>)[k] = v;
  }
  const payload: EventPayload = {
    event,
    ...safe,
    lead_id: lead?.lead_id,
    session_id: getSessionId(),
    customer_id: customerId,
    utm_source: a.utm_source,
    utm_medium: a.utm_medium,
    utm_campaign: a.utm_campaign,
    utm_term: a.utm_term,
    utm_content: a.utm_content,
    gclid: a.gclid,
    landing_intent: a.landing_intent,
    page_path: typeof location !== 'undefined' ? location.pathname : '',
    ts: new Date().toISOString(),
  };

  // 1) GTM / dataLayer (PRODUCTION INTEGRATION: load GTM container via VITE_GTM_ID)
  if (typeof window !== 'undefined') {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);
    // 2) gtag direct (GA4)
    if (window.gtag && env.ga4Id) window.gtag('event', event, payload);
  }
  // 3) First-party event collector (server can forward to warehouse / CAPI)
  if (!import.meta.env.DEV && env.mode === 'production' && typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    try {
      navigator.sendBeacon(`${env.apiBase}/events`, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    } catch {
      /* never block the funnel on analytics */
    }
  }
  standardEvent(event, safe);
  debugLog.push(payload);
  if (env.analyticsDebug) console.info('[rr:track]', event, payload);
  return payload;
}

const item = (p?: ProductId | 'bundle' | 'premium') =>
  p && p !== 'bundle' && p !== 'premium' ? [{ item_id: p, item_name: PRODUCTS[p].name, price: dollars(PRODUCTS[p].priceCents), quantity: 1 }] : undefined;

/**
 * GA4 recommended events + Meta standard events, derived from funnel events.
 * Pixels never receive lead/customer ids, names, emails, quiz answers or anything about credit.
 */
function standardEvent(event: FunnelEvent, p: EventProps) {
  if (typeof window === 'undefined') return;
  const ga = (name: string, params: Record<string, unknown>) => window.gtag && env.ga4Id && window.gtag('event', name, { send_to: env.ga4Id, ...params });
  const value = p.order_value;
  switch (event) {
    case 'product_view':
      ga('view_item', { currency: 'USD', value, items: item(p.product) });
      meta('ViewContent', { content_ids: [p.product], content_type: 'product', currency: 'USD', value });
      break;
    case 'checkout_view':
      ga('begin_checkout', { currency: 'USD', value, items: item(p.product) });
      break;
    case 'checkout_started':
      ga('add_payment_info', { currency: 'USD', value, items: item(p.product) });
      meta('InitiateCheckout', { content_ids: [p.product], currency: 'USD', value });
      break;
    case 'lead_captured':
    case 'free_resource_requested':
      ga('generate_lead', { currency: 'USD', value: 0 });
      meta('Lead', {});
      break;
  }
}

/**
 * The ONE place a purchase is reported to analytics and ad platforms.
 * - value comes from the verified order amount (never a hardcoded number)
 * - each transaction id is reported once per browser, so reloads/back-button never double count
 */
export function trackPurchase(kind: 'front' | 'upsell' | 'upgrade', product: ProductId, amountCents: number, transactionId?: string) {
  const tx = transactionId || `${product}_${Date.now()}`;
  const seen = read<string[]>('tracked_tx', []);
  if (seen.includes(tx)) return false;
  write('tracked_tx', [...seen, tx].slice(-30));
  const value = dollars(amountCents);
  const event: FunnelEvent = kind === 'upsell' ? 'upsell_purchase_success' : kind === 'upgrade' ? 'upgrade_purchase_success' : 'credit_purchase_success';
  track(event, { product, order_value: value, revenue: value, transaction_id: tx });
  if (typeof window !== 'undefined' && window.gtag && env.ga4Id) {
    window.gtag('event', 'purchase', { send_to: env.ga4Id, transaction_id: tx, value, currency: 'USD', items: item(product) });
  }
  reportAdsConversion(kind === 'upsell' ? 'upsell' : 'purchase', value, tx);
  // eventID lets Meta de-duplicate against a server-side Conversions API event with the same id.
  meta('Purchase', { value, currency: 'USD', content_ids: [product], content_type: 'product' }, tx);
  return true;
}

// ---------------------------------------------------------------- consent (Google Consent Mode v2 + Meta)
export type ConsentChoice = 'granted' | 'denied';
export const consentRequired = () => env.requireTrackingConsent;
export const getConsent = (): ConsentChoice | null => read<ConsentChoice | null>('tracking_consent', null);

/** Ads/measurement cookies only after a choice when consent is required; otherwise default granted (US). */
function consentState(): ConsentChoice {
  if (!env.requireTrackingConsent) return 'granted';
  return getConsent() || 'denied';
}

export function setConsent(choice: ConsentChoice) {
  write('tracking_consent', choice);
  if (typeof window === 'undefined') return;
  window.gtag?.('consent', 'update', { ad_storage: choice, ad_user_data: choice, ad_personalization: choice, analytics_storage: choice });
  if (choice === 'granted') loadMeta();
}

// ---------------------------------------------------------------- Meta Pixel (optional)
let metaLoaded = false;
function loadMeta() {
  if (metaLoaded || !env.metaPixelId || typeof document === 'undefined' || consentState() !== 'granted') return;
  metaLoaded = true;
  type Fbq = ((...a: unknown[]) => void) & { queue: unknown[][]; callMethod?: (...a: unknown[]) => void; loaded?: boolean; version?: string; push?: unknown };
  const q = function (...a: unknown[]) {
    if (f.callMethod) f.callMethod(...a);
    else f.queue.push(a);
  } as Fbq;
  const f = q;
  f.queue = [];
  f.loaded = true;
  f.version = '2.0';
  f.push = f;
  window.fbq = f;
  if (!window._fbq) window._fbq = f;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(s);
  // No advanced matching: Meta never receives email, name or phone from this site.
  f('init', env.metaPixelId);
  f('track', 'PageView');
}

function meta(name: string, params: Record<string, unknown>, eventId?: string) {
  if (!metaLoaded || typeof window === 'undefined' || !window.fbq) return;
  window.fbq('track', name, params, eventId ? { eventID: eventId } : undefined);
}

/**
 * Google Ads conversions. Fires only when IDs/labels are configured.
 * Purchase conversions should ideally ALSO be uploaded server-side
 * (enhanced conversions / offline import keyed by gclid) from the verified webhook.
 */
export function reportAdsConversion(kind: 'lead' | 'purchase' | 'upsell', value?: number, transactionId?: string) {
  const label = { lead: env.googleAdsLeadLabel, purchase: env.googleAdsPurchaseLabel, upsell: env.googleAdsUpsellLabel }[kind];
  if (!env.googleAdsId || !label || typeof window === 'undefined' || !window.gtag) return;
  window.gtag('event', 'conversion', {
    send_to: `${env.googleAdsId}/${label}`,
    value,
    currency: 'USD',
    transaction_id: transactionId,
  });
}

/** Loads GTM/gtag only when configured. No-op in a fresh checkout of this repo. */
export function bootAnalytics() {
  if (typeof document === 'undefined') return;
  const id = env.gtmId;
  if (id) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  }
  const tagId = env.ga4Id || env.googleAdsId;
  if (tagId) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(tagId)}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    const c = consentState();
    window.gtag('consent', 'default', { ad_storage: c, ad_user_data: c, ad_personalization: c, analytics_storage: c, wait_for_update: 500 });
    window.gtag('js', new Date());
    if (env.ga4Id) window.gtag('config', env.ga4Id, { send_page_view: false });
    if (env.googleAdsId) window.gtag('config', env.googleAdsId);
  }
  loadMeta();
}
