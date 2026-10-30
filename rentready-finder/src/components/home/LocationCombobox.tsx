import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { autocompleteLocation } from '../../services/api';
import type { LocationSuggestion } from '../../types/property';
import { useDebounce } from '../../hooks/useDebounce';
import { PinIcon, SearchIcon } from '../ui/Icons';
import { inputClass } from '../ui/Field';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: LocationSuggestion) => void;
  invalid?: boolean;
  describedBy?: string;
}

/**
 * Accessible location combobox (WAI-ARIA 1.2 pattern).
 * Suggestions come from the server-side Places Autocomplete endpoint (Phase B) —
 * debounced, and each keystroke cancels the previous in-flight request.
 */
export function LocationCombobox({ value, onChange, onSelect, invalid, describedBy }: Props) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LocationSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const debounced = useDebounce(value.trim(), 280);
  const abortRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Only the visitor's own typing asks Google for suggestions — never a city the page filled in (each lookup costs money).
  const typed = useRef(false);

  useEffect(() => {
    abortRef.current?.abort();
    if (debounced.length < 2 || !typed.current) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    autocompleteLocation(debounced, ctrl.signal)
      .then((res) => {
        if (!ctrl.signal.aborted) {
          setItems(res.slice(0, 6));
          setActive(-1);
        }
      })
      .catch(() => !ctrl.signal.aborted && setItems([]));
    return () => ctrl.abort();
  }, [debounced]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const showList = open && items.length > 0;

  const choose = (s: LocationSuggestion) => {
    onSelect(s);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === 'Enter' && showList && active >= 0) {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <SearchIcon size={19} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-navy-600" />
      <input
        id="location-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        placeholder="City, state, ZIP code, or address"
        value={value}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={`${inputClass} h-14 !rounded-full !bg-offwhite pl-12 pr-5 text-[16px] ${invalid ? '!border-[#B4553F] focus:!ring-[#B4553F]/20' : ''}`}
      />
      {showList ? (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-[calc(100%+8px)] z-30 overflow-hidden rounded-[20px] border border-mist bg-white py-2 shadow-float">
          {items.map((s, i) => (
            <li
              key={s.placeId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 ${i === active ? 'bg-offwhite' : ''}`}
            >
              <PinIcon size={16} className="shrink-0 text-gold-600" />
              <span className="text-[14.5px] text-navy-900">{s.primaryText}</span>
              <span className="truncate text-[13px] text-stone-500">{s.secondaryText}</span>
            </li>
          ))}
          <li className="px-4 pb-1 pt-2 text-right text-[10.5px] text-stone-500" aria-hidden="true">
            Suggestions powered by Google
          </li>
        </ul>
      ) : null}
    </div>
  );
}
