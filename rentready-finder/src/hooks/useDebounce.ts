import { useEffect, useState } from 'react';

export function useDebounce<T>(value: T, delay = 280): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}
