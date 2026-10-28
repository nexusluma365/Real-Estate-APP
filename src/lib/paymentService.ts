/**
 * PAYMENT SERVICE — the only place the funnel talks about money.
 *
 * Architecture (production):
 *   1. createCustomer()          → server creates/reuses Stripe Customer for the lead
 *   2. createPaymentIntent()     → server creates PI (book $47.99 | Digital Bundle $79.99 | upgrade $32);
 *                                  Bundle + upgrade use setup_future_usage='off_session' for the optional one-click Playbook
 *   3. Stripe Payment Element    → card entered inside Stripe iframe (never in our DOM/state/storage)
 *   4. confirmPayment()          → stripe.confirmPayment (client, publishable key only)
 *   5. verifyPaymentServerSide() → server retrieves PI, checks status/amount/customer, creates order+entitlement
 *   6. attachPaymentMethod()     → server-side; PI with setup_future_usage attaches PM to Customer
 *   7. savePaymentMethodForUpsell() → server records PM as the upsell method + consent text shown at checkout
 *   8. chargeUpsell()            → ONLY after explicit click: server creates off_session PI for $100 on saved PM
 *
 * Webhooks (payment_intent.succeeded) are the source of truth; verify endpoints are idempotent mirrors.
 * Secret keys exist ONLY in the Netlify Functions environment. Nothing here may use them.
 */
import { api, ApiError, wait } from './api';
import { isMock } from './env';
import { read, uid, write } from './storage';
import type { MockOutcome, Order, ProductId } from './types';
import { PRODUCTS } from '../config/products';
import { grantMockEntitlement } from './entitlementService';
import { emitLifecycle } from './lifecycle';

export interface CustomerRef {
  customer_id: string;
}
export interface PaymentIntentRef {
  payment_intent_id: string;
  client_secret: string;
  amount_cents: number;
}
export interface VerifyResult {
  verified: boolean;
  order?: Order;
  products: ProductId[];
}
export type ConfirmResult =
  | { status: 'succeeded'; payment_intent_id: string }
  | { status: 'declined'; message: string }
  | { status: 'validation_error'; message: string }
  | { status: 'network_error'; message: string };

export type UpsellChargeResult =
  | { status: 'succeeded'; payment_intent_id: string }
  | { status: 'requires_action'; payment_intent_id: string; client_secret: string }
  | { status: 'declined'; message: string }
  | { status: 'error'; message: string };

const DECLINE_MSG = 'Your card was declined. Try a different card or contact your bank.';

// ---------------------------------------------------------------- 1
export async function createCustomer(leadId: string): Promise<CustomerRef> {
  if (isMock) {
    const existing = read<CustomerRef | null>('mock.customer', null);
    if (existing) return existing;
    await wait(250);
    const c = { customer_id: uid('mock_cus') };
    write('mock.customer', c);
    return c;
  }
  // Server: netlify/lib/api/payments/customer.ts
  return api<CustomerRef>('/payments/customer', { json: { lead_id: leadId } });
}

// ---------------------------------------------------------------- 2
export async function createPaymentIntent(args: {
  customerId: string;
  product: ProductId;
  idempotencyKey: string;
}): Promise<PaymentIntentRef> {
  if (isMock) {
    await wait(350);
    return { payment_intent_id: uid('mock_pi'), client_secret: 'mock_secret_not_real', amount_cents: PRODUCTS[args.product].priceCents };
  }
  // Server decides the amount from the product id — the client never sends a price.
  return api<PaymentIntentRef>('/payments/intent', {
    json: { customer_id: args.customerId, product: args.product },
    headers: { 'Idempotency-Key': args.idempotencyKey },
  });
}

// ---------------------------------------------------------------- 4
export async function confirmPayment(args: {
  paymentIntentId: string;
  /** production: a function that runs stripe.confirmPayment and returns its result */
  confirmWithStripe?: () => ReturnType<import('./stripe').StripeLike['confirmPayment']>;
  mockOutcome?: MockOutcome;
}): Promise<ConfirmResult> {
  if (isMock) {
    await wait(1300);
    switch (args.mockOutcome) {
      case 'decline':
        return { status: 'declined', message: DECLINE_MSG };
      case 'network_error':
        return { status: 'network_error', message: 'The connection dropped before your payment finished. You have not been charged twice — try again.' };
      default:
        return { status: 'succeeded', payment_intent_id: args.paymentIntentId };
    }
  }
  if (!args.confirmWithStripe) return { status: 'validation_error', message: 'Payment form is not ready yet.' };
  try {
    const { error, paymentIntent } = await args.confirmWithStripe();
    if (error) {
      if (error.type === 'card_error') return { status: 'declined', message: error.message || DECLINE_MSG };
      if (error.type === 'validation_error') return { status: 'validation_error', message: error.message };
      return { status: 'network_error', message: error.message };
    }
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      return { status: 'succeeded', payment_intent_id: paymentIntent.id };
    }
    return { status: 'declined', message: DECLINE_MSG };
  } catch {
    return { status: 'network_error', message: 'We could not reach the payment processor. Try again.' };
  }
}

// ---------------------------------------------------------------- 5
export async function verifyPaymentServerSide(paymentIntentId: string, product: ProductId): Promise<VerifyResult> {
  if (isMock) {
    await wait(500);
    const order: Order = {
      order_id: uid('mock_ord'),
      product,
      amount_cents: PRODUCTS[product].priceCents,
      payment_intent_id: paymentIntentId,
      created_at: new Date().toISOString(),
    };
    const orders = read<Order[]>('mock.orders', []);
    if (!orders.some((o) => o.payment_intent_id === paymentIntentId)) write('mock.orders', [...orders, order]);
    // The upgrade order grants the Digital Bundle entitlement (the server does the same).
    const products = grantMockEntitlement(product === 'upgrade' ? 'creditready' : product);
    // In production the Stripe webhook emits this; the mock mirrors it so the outbox shows the full journey.
    void emitLifecycle('purchase_completed', { product, order_id: order.order_id });
    return { verified: true, order, products };
  }
  // Server: netlify/lib/api/payments/verify.ts — retrieve PI with secret key,
  // assert status==='succeeded', amount & currency match product, customer matches session,
  // then idempotently create order + entitlement and return them.
  return api<VerifyResult>('/payments/verify', { json: { payment_intent_id: paymentIntentId, product } });
}

// ---------------------------------------------------------------- 6
/** Server-side only. With setup_future_usage the PM is attached on success; this exists for explicit flows (e.g. SetupIntent). */
export async function attachPaymentMethod(paymentIntentId: string): Promise<{ attached: boolean }> {
  if (isMock) return { attached: true };
  return api('/payments/attach', { json: { payment_intent_id: paymentIntentId } });
}

// ---------------------------------------------------------------- 7
export async function savePaymentMethodForUpsell(paymentIntentId: string): Promise<{ saved: boolean }> {
  if (isMock) {
    write('mock.saved_pm', { source_pi: paymentIntentId, card_label: 'saved test card' });
    return { saved: true };
  }
  return api('/payments/save-method', { json: { payment_intent_id: paymentIntentId } });
}

export function getSavedMethodLabel(): string {
  const m = read<{ card_label: string } | null>('mock.saved_pm', null);
  return m?.card_label || 'the card from your Digital Bundle purchase';
}

// ---------------------------------------------------------------- 8
/** Called ONLY from the upsell accept button. Never on mount, never on a timer. */
export async function chargeUpsell(args: { idempotencyKey: string; mockOutcome?: MockOutcome }): Promise<UpsellChargeResult> {
  if (isMock) {
    await wait(1400);
    switch (args.mockOutcome) {
      case 'decline':
        return { status: 'declined', message: 'Your saved card was declined for this purchase. You still have full access to your Digital Bundle.' };
      case 'requires_action':
        return { status: 'requires_action', payment_intent_id: uid('mock_pi'), client_secret: 'mock_secret_not_real' };
      case 'network_error':
        return { status: 'error', message: 'We could not complete that request. You have not been charged.' };
      default:
        return { status: 'succeeded', payment_intent_id: uid('mock_pi') };
    }
  }
  try {
    return await api<UpsellChargeResult>('/upsell/charge', {
      json: { product: 'playbook' },
      headers: { 'Idempotency-Key': args.idempotencyKey },
    });
  } catch (e) {
    return { status: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong. You have not been charged.' };
  }
}

/** Per-attempt idempotency key so a double click or refresh never creates two charges. */
export function attemptKey(scope: string): string {
  const k = `attempt.${scope}`;
  let v = read<string>(k, '', 'session');
  if (!v) {
    v = uid(scope);
    write(k, v, 'session');
  }
  return v;
}
export const resetAttemptKey = (scope: string) => write(`attempt.${scope}`, '', 'session');
