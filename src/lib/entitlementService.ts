import { api } from './api';
import { isMock } from './env';
import { read, write } from './storage';
import type { Entitlements, ProductId } from './types';

/**
 * Paid access is decided by the SERVER. Visiting /welcome, /gameplan or /access
 * only asks the server "what does this session own?" — it never grants anything.
 *
 * PRODUCTION INTEGRATION: GET /api/entitlements reads the HttpOnly session cookie,
 * looks up the customer, and returns owned products from the entitlements table
 * (written by the Stripe webhook / verify endpoint).
 */
export async function fetchEntitlements(): Promise<Entitlements> {
  if (isMock) {
    const products = read<ProductId[]>('mock.entitlements', []);
    const cust = read<{ customer_id: string } | null>('mock.customer', null);
    const lead = read<{ first_name: string } | null>('lead', null);
    return {
      status: 'loaded',
      products,
      customer_id: products.length ? cust?.customer_id : undefined,
      first_name: lead?.first_name,
      source: products.length ? 'mock' : 'none',
    };
  }
  try {
    const r = await api<{ customer_id?: string; first_name?: string; products: ProductId[]; premium?: Entitlements['premium']; signed_in?: boolean }>('/entitlements');
    return { status: 'loaded', ...r, source: 'server' };
  } catch {
    return { status: 'error', products: [], source: 'none' };
  }
}

/** Mock-only. Called exclusively by the mock verify step after a simulated successful payment. */
export function grantMockEntitlement(product: ProductId): ProductId[] {
  if (!isMock) throw new Error('grantMockEntitlement is unavailable outside mock mode');
  const owned = new Set(read<ProductId[]>('mock.entitlements', []));
  owned.add(product);
  const list = [...owned];
  write('mock.entitlements', list);
  return list;
}

/**
 * PRODUCTION INTEGRATION: returning customers request a magic link (POST /api/access/link)
 * which sets the session cookie when clicked. Mock mode just reports success.
 */
export async function requestAccessLink(email: string): Promise<void> {
  if (isMock) return;
  await api('/access/link', { json: { email } });
}
