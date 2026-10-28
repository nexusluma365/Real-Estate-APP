/**
 * Namespaced, failure-tolerant browser storage.
 * Never store card data, secrets, or full payment objects here.
 */
const NS = 'rr.';

function area(kind: 'local' | 'session'): Storage | null {
  try {
    const s = kind === 'local' ? window.localStorage : window.sessionStorage;
    const probe = NS + '__probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function read<T>(key: string, fallback: T, kind: 'local' | 'session' = 'local'): T {
  const s = area(kind);
  if (!s) return fallback;
  try {
    const raw = s.getItem(NS + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function write<T>(key: string, value: T, kind: 'local' | 'session' = 'local'): void {
  const s = area(kind);
  if (!s) return;
  try {
    s.setItem(NS + key, JSON.stringify(value));
  } catch {
    /* quota or privacy mode — the funnel still works in memory */
  }
}

export function remove(key: string, kind: 'local' | 'session' = 'local'): void {
  const s = area(kind);
  try {
    s?.removeItem(NS + key);
  } catch {
    /* ignore */
  }
}

export function uid(prefix: string): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${raw.replace(/-/g, '').slice(0, 20)}`;
}
