export const sanitizeText = (v: string, max = 80) =>
  v.replace(/[<>\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export function validateFirstName(v: string): string | null {
  const s = sanitizeText(v, 40);
  if (!s) return 'Enter your first name.';
  if (s.length < 2) return 'First name needs at least 2 letters.';
  if (!/^[\p{L}][\p{L}' .-]*$/u.test(s)) return 'Use letters only in your first name.';
  return null;
}

export function validateEmail(v: string): string | null {
  const s = v.trim();
  if (!s) return 'Enter your email so we can send your access.';
  if (s.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return 'Enter a valid email, like name@example.com.';
  return null;
}

export const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 });
