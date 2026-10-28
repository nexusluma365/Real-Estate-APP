import { useId } from 'react';

/**
 * Original illustration: the apartment you want, at dusk.
 * IMAGE SLOT: replace with licensed lifestyle photography by passing `src`.
 */
export function WindowScene({ src, alt = '' }: { src?: string; alt?: string }) {
  const id = useId().replace(/:/g, '');
  if (src) return <img className="illu" src={src} alt={alt} loading="eager" />;
  return (
    <svg className="illu" viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice" role="img" aria-label="A city apartment window at dusk">
      <defs>
        <linearGradient id={`sky${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c4a60" />
          <stop offset="0.55" stopColor="#8fb6cf" />
          <stop offset="0.85" stopColor="#e6c99a" />
          <stop offset="1" stopColor="#d9a866" />
        </linearGradient>
        <linearGradient id={`room${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2620" />
          <stop offset="1" stopColor="#171510" />
        </linearGradient>
        <radialGradient id={`lamp${id}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#f3d9a6" stopOpacity="0.55" />
          <stop offset="1" stopColor="#f3d9a6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`floor${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3127" />
          <stop offset="1" stopColor="#201c16" />
        </linearGradient>
      </defs>
      <rect width="400" height="500" fill={`url(#room${id})`} />
      {/* window */}
      <rect x="70" y="40" width="270" height="330" fill={`url(#sky${id})`} />
      <g fill="#1d2a33" opacity="0.92">
        <rect x="70" y="262" width="34" height="108" />
        <rect x="104" y="232" width="26" height="138" />
        <rect x="130" y="280" width="40" height="90" />
        <rect x="170" y="210" width="22" height="160" />
        <rect x="192" y="250" width="38" height="120" />
        <rect x="230" y="226" width="30" height="144" />
        <rect x="260" y="270" width="44" height="100" />
        <rect x="304" y="244" width="36" height="126" />
      </g>
      <g fill="#f1d49a" opacity="0.8">
        {[
          [110, 250], [118, 270], [176, 230], [182, 262], [200, 268], [214, 290], [238, 244], [246, 300], [312, 260], [322, 290], [140, 300], [272, 288],
        ].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="4" height="6" />
        ))}
      </g>
      {/* mullions */}
      <g stroke="#14120e" strokeWidth="7">
        <rect x="70" y="40" width="270" height="330" fill="none" />
        <line x1="205" y1="40" x2="205" y2="370" />
        <line x1="70" y1="160" x2="340" y2="160" />
      </g>
      {/* sill + floor */}
      <rect x="56" y="368" width="298" height="10" fill="#2f2a22" />
      <rect y="420" width="400" height="80" fill={`url(#floor${id})`} />
      <path d="M90 420 L320 420 L360 500 L50 500 Z" fill="#9cc3dd" opacity="0.08" />
      {/* pendant lamp */}
      <line x1="318" y1="0" x2="318" y2="70" stroke="#4a4237" strokeWidth="1.5" />
      <path d="M298 70 h40 l-8 22 h-24 z" fill="#c49a55" />
      <ellipse cx="318" cy="110" rx="170" ry="190" fill={`url(#lamp${id})`} />
      {/* chair silhouette */}
      <path d="M40 420 v-60 q0-16 16-16 h46 q16 0 16 16 v26 h-62 v34 z" fill="#0f0e0b" opacity="0.85" />
      <rect x="44" y="420" width="4" height="30" fill="#0f0e0b" />
      <rect x="108" y="420" width="4" height="30" fill="#0f0e0b" />
    </svg>
  );
}

export interface SheetValues {
  rent: string;
  income: string;
  credit: string;
  history: string;
}

/** The signature object: a rental application. Front = what you see. Back = what may be reviewed. */
export function ApplicationSheet({ values, unknown = [] as (keyof SheetValues)[], label = 'Rental application' }: { values: SheetValues; unknown?: (keyof SheetValues)[]; label?: string }) {
  const row = (k: keyof SheetValues, t: string) => (
    <div className="sheet-row">
      <dt>{t}</dt>
      <dd className={unknown.includes(k) ? 'unknown' : undefined}>{values[k]}</dd>
    </div>
  );
  return (
    <div className="sheet" aria-label={label}>
      <div className="sheet-head">
        <span className="sheet-title">{label}</span>
        <span className="sheet-no">Unit 4B</span>
      </div>
      <dl style={{ margin: 0 }}>
        {row('rent', 'Monthly rent')}
        {row('income', 'Gross monthly income')}
        {row('credit', 'Credit')}
        {row('history', 'Rental history')}
      </dl>
      <div className="sheet-foot">
        <span className="sheet-sign">Applicant signature</span>
        <span className="sheet-submit">Submit</span>
      </div>
    </div>
  );
}

export function ScreeningSheet({ rows }: { rows: { label: string; note: string }[] }) {
  return (
    <div className="sheet sheet-back" aria-label="Screening review">
      <div className="sheet-head">
        <span className="sheet-title">Screening review</span>
        <span className="sheet-no">Property side</span>
      </div>
      <dl style={{ margin: 0 }}>
        {rows.map((r) => (
          <div className="sheet-row" key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.note}</dd>
          </div>
        ))}
      </dl>
      <div className="sheet-foot">
        <span className="sheet-sign">Criteria vary by property</span>
      </div>
    </div>
  );
}

export function Book({ kind, size }: { kind: 'creditready' | 'playbook'; size?: number }) {
  const cr = kind === 'creditready';
  return (
    <div className={`book ${cr ? 'book-cr' : 'book-pm'}`} style={size ? ({ ['--w' as string]: `${size}px` } as React.CSSProperties) : undefined} role="img" aria-label={cr ? 'RentReady Digital Bundle cover' : 'Property Manager Playbook cover'}>
      <div className="book-lines" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <i key={i} style={{ width: `${90 - i * 9}%` }} />
        ))}
      </div>
      <span className="book-seal" aria-hidden="true">{cr ? 'CR' : 'PM'}</span>
      <div className="book-inner">
        <span className="book-brand">RENTREADY</span>
        <span className="book-title">{cr ? <>RentReady<br />Digital Bundle</> : <>The Property<br />Manager<br />Playbook</>}</span>
        <span className="book-rule" />
        <span className="book-sub">{cr ? 'Your credit, reviewed and organized before you apply.' : 'Your application, from the other side of the desk.'}</span>
      </div>
    </div>
  );
}

export function ProductStage({ kind }: { kind: 'creditready' | 'playbook' }) {
  return (
    <div className="mockup-stage" aria-hidden="false">
      <div className="mock-pages" aria-hidden="true">
        <b>{kind === 'creditready' ? 'Action checklist' : 'Before you pay a fee'}</b>
        {[1, 1, 0, 0, 0].map((on, i) => (
          <div className="chk" key={i}>
            <span className={on ? 'on' : ''} />
            <i style={{ width: `${88 - i * 10}%` }} />
          </div>
        ))}
        <i style={{ width: '70%', marginTop: 8 }} />
        <i style={{ width: '82%' }} />
        <i style={{ width: '56%' }} />
      </div>
      <Book kind={kind} />
    </div>
  );
}
