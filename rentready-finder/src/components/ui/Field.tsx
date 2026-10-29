import type { ReactNode, SelectHTMLAttributes, InputHTMLAttributes } from 'react';

export const inputClass =
  'h-12 w-full rounded-[14px] border border-mist bg-offwhite/60 px-4 text-[15px] text-charcoal placeholder:text-stone-500 transition-[border-color,box-shadow] duration-200 ease-lux hover:border-stone-300 focus:border-gold focus:outline-none focus:ring-[3px] focus:ring-gold/25';

export function FieldLabel({ htmlFor, children, hint }: { htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-2 flex items-baseline justify-between text-[11.5px] font-semibold uppercase tracking-[0.14em] text-navy-600">
      <span>{children}</span>
      {hint ? <span className="text-[11px] font-medium normal-case tracking-normal text-stone-500">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        {...props}
        className={`${inputClass} appearance-none pr-10 ${props.className ?? ''}`}
      >
        {children}
      </select>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-600">
        <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
