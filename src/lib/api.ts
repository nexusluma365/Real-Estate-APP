import { env } from './env';

const contact = () => (env.supportEmail ? ` or email ${env.supportEmail}` : '');

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string = 'api_error',
  ) {
    super(message);
  }
}

/**
 * Single fetch wrapper for every backend call.
 * Cookies carry the server session (HttpOnly) — the browser never holds secrets.
 * PRODUCTION INTEGRATION: endpoints are implemented in netlify/lib/api/* (served by netlify/functions/api.mts)
 * or can be pointed at the existing RentReady backend via VITE_API_BASE_URL.
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${env.apiBase}${path}`, {
      credentials: 'include',
      ...rest,
      method: rest.method || (json !== undefined ? 'POST' : 'GET'),
      headers: { Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError('We could not reach RentReady. Check your connection and try again.', 0, 'network_error');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const d = (data || {}) as { error?: string; code?: string };
    // Server-side setup problems and crashes are logged for us, never shown to visitors in technical terms.
    if (d.code === 'not_configured' || res.status >= 500) {
      console.error(`RentReady API ${path} → ${res.status}`, d.error || '');
      throw new ApiError(`We’re having trouble on our side right now. Please try again in a few minutes${contact()}.`, res.status, d.code || 'server_error');
    }
    throw new ApiError(d.error || `Something went wrong (${res.status}). Please try again.`, res.status, d.code || 'api_error');
  }
  return data as T;
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
