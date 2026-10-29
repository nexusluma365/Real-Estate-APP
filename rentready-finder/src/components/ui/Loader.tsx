interface LoaderProps {
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'light';
  label?: string;
  className?: string;
}

/** 3D rotating navy/gold loader. Always paired with an accessible status message. */
export function Loader({ size = 'md', tone = 'default', label, className = '' }: LoaderProps) {
  const cls = ['rr-loader', size === 'sm' && 'rr-loader--sm', size === 'lg' && 'rr-loader--lg', tone === 'light' && 'rr-loader--light']
    .filter(Boolean)
    .join(' ');
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center gap-4 ${className}`}>
      <span className={cls} aria-hidden="true" />
      {label ? <span className="text-sm font-medium tracking-wide text-navy-700">{label}</span> : <span className="sr-only">Loading</span>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-[14px] ${className}`} />;
}
