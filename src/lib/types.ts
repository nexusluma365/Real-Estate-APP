/** `upgrade` is an order type only (book → Digital Bundle); it grants the `creditready` entitlement. */
export type ProductId = 'creditready' | 'playbook' | 'guide' | 'upgrade';

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  gclid?: string;
  landing_intent?: string;
  landing_path?: string;
  referrer?: string;
  captured_at?: string;
}

export interface Lead {
  lead_id: string;
  first_name: string;
  email: string;
  email_consent: boolean;
  consent_basis?: 'checkbox' | 'notice';
  consent_text?: string;
  lead_source?: string;
  product_interest?: string;
  qualification?: { stage?: string; concern?: string; help?: string; intent_tier: string; recommended: string };
  session_id: string;
  timestamp: string;
  attribution: Attribution;
  /** true when created by the local mock, never in production */
  mock?: boolean;
}

export interface Entitlements {
  status: 'loading' | 'loaded' | 'error';
  customer_id?: string;
  first_name?: string;
  products: ProductId[];
  /** RentReady Premium membership (server-decided; absent in mock mode). */
  premium?: { active: boolean; had_premium?: boolean; status?: string | null; current_period_end?: string | null; cancel_at_period_end?: boolean };
  /** Server-issued. In mock mode this is a local simulation flag. */
  source: 'server' | 'mock' | 'none';
}

export type CheckoutStatus =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'processing'
  | 'verifying'
  | 'success'
  | 'declined'
  | 'validation_error'
  | 'network_error'
  | 'config_error';

export type UpsellStatus = 'ready' | 'processing' | 'success' | 'declined' | 'requires_action' | 'error';

export type MockOutcome = 'success' | 'decline' | 'network_error' | 'requires_action';

export interface Order {
  order_id: string;
  product: ProductId;
  amount_cents: number;
  payment_intent_id: string;
  created_at: string;
}

export type Rating = 'strong' | 'review' | 'attention';
