import { useEffect, useRef, useState } from 'react';

export interface ScanStatus { pending: number; checked: number; found: number }

/**
 * When an area has no second-chance listings yet, ask the server to check its apartment communities' websites
 * (once per area per browser session; the server also limits each area to once a day), then follow progress.
 * `onFound` runs whenever a new second-chance property is confirmed, so the listings can refresh.
 */
export function useSecondChanceScan(place: string | null, active: boolean, onFound: () => void) {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const found = useRef(0);
  const cb = useRef(onFound);
  cb.current = onFound;

  useEffect(() => {
    setStatus(null);
    found.current = 0;
    if (!place || !active) return;
    let stop = false;
    let timer = 0;
    const key = `rr.finder.scan.${place.toLowerCase()}`;
    const read = (s: ScanStatus) => {
      if (stop) return;
      setStatus(s);
      if (s.found > found.current) {
        found.current = s.found;
        cb.current();
      }
      // Keep following while websites are still queued (up to ~8 minutes).
      if (s.pending > 0 && Date.now() - started < 8 * 60000) timer = window.setTimeout(poll, 12000);
    };
    const poll = () =>
      fetch(`/api/scan/area?place=${encodeURIComponent(place)}`, { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s && read(s))
        .catch(() => undefined);
    const started = Date.now();
    let asked = false;
    try {
      asked = sessionStorage.getItem(key) === '1';
      sessionStorage.setItem(key, '1');
    } catch {
      /* storage unavailable */
    }
    if (asked) void poll();
    else
      fetch('/api/scan/area', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ place }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => (s ? read(s) : poll()))
        .catch(() => undefined);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [place, active]);

  return status;
}

/** "Charlotte, NC, USA" → "Charlotte, NC". */
export const cleanPlace = (p: string) => p.replace(/,\s*(USA|United States)$/i, '');
