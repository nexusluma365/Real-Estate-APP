import { env } from './env';

/**
 * Minimal Stripe.js surface used by the funnel. Stripe.js is loaded from js.stripe.com
 * (required by Stripe — never self-host it). Card data is entered inside Stripe's iframe
 * and never touches this app, its storage, or its servers.
 */
export interface StripeElement {
  mount(el: HTMLElement): void;
  destroy(): void;
  on(event: 'change' | 'ready', cb: (e: { complete?: boolean; error?: { message: string } }) => void): void;
}
export interface StripeElements {
  create(type: 'payment' | 'address', opts?: Record<string, unknown>): StripeElement;
  submit(): Promise<{ error?: { message: string } }>;
}
export interface StripeLike {
  elements(opts: { clientSecret: string; appearance?: Record<string, unknown> }): StripeElements;
  confirmPayment(opts: {
    elements: StripeElements;
    redirect: 'if_required';
    confirmParams: { return_url: string };
  }): Promise<{ error?: { type: string; code?: string; message: string }; paymentIntent?: { id: string; status: string } }>;
  handleNextAction(opts: { clientSecret: string }): Promise<{
    error?: { message: string };
    paymentIntent?: { id: string; status: string };
  }>;
}

let promise: Promise<StripeLike> | null = null;

export function loadStripe(): Promise<StripeLike> {
  if (!env.stripePublishableKey) {
    return Promise.reject(new Error('Payments are not configured: VITE_STRIPE_PUBLISHABLE_KEY is missing.'));
  }
  if (promise) return promise;
  promise = new Promise<StripeLike>((resolve, reject) => {
    const done = () => (window.Stripe ? resolve(window.Stripe(env.stripePublishableKey) as StripeLike) : reject(new Error('Stripe failed to load.')));
    if (window.Stripe) return done();
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.async = true;
    s.onload = done;
    s.onerror = () => {
      promise = null;
      reject(new Error('Stripe could not load. Check your connection or content blockers.'));
    };
    document.head.appendChild(s);
  });
  return promise;
}

/** Appearance tuned to the RentReady palette for the Payment Element. */
export const stripeAppearance = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#1C1A16',
    colorText: '#1C1A16',
    colorDanger: '#A2412F',
    fontFamily: '"Hanken Grotesk", system-ui, sans-serif',
    borderRadius: '6px',
    spacingUnit: '4px',
  },
  rules: { '.Input': { borderColor: '#D9CFBD', boxShadow: 'none' }, '.Input:focus': { borderColor: '#B0843F' } },
};
