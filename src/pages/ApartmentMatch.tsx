import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Seo } from '../components/Seo';
import { Spinner } from '../components/ui';
import { captureLead, restoreSession } from '../lib/leadService';
import { reportAdsConversion, track, type EventProps, type FunnelEvent } from '../lib/analytics';
import { emitLifecycle } from '../lib/lifecycle';
import { ApiError } from '../lib/api';
import { isMock } from '../lib/env';
import { read, write } from '../lib/storage';
import { money, sanitizeText, validateEmail, validateFirstName } from '../lib/validation';
import { fetchPremiumOffer, requestSignInLink, startPremium, type PremiumOffer } from '../lib/memberService';
import { useFunnel } from '../state/FunnelContext';

/**
 * /find-my-apartment — the "Find Apartments" CTA. A short animated greeting that runs straight into the questions
 * (no button to press), five one-per-screen questions each answered then confirmed with a small Next,
 * a personal transition, lead capture (the search link is emailed via the `search_saved` lifecycle event), then the
 * RentReady Premium offer with its real terms from /api/premium/offer — and the free search always one tap away.
 *
 * Returning visitors can sign in (top corner) with an emailed link instead of answering again. Anyone signed in (by that
 * link or a purchase) goes straight to the apartment listings — their saved search when there is one.
 *
 * Privacy: answers live on this device (localStorage `rr.match`). Only the search area leaves it — as the Finder
 * query and in the search-link email. Rental-concern answers are never sent anywhere: not to analytics, ad platforms,
 * the lead record or the server.
 */
type Glyph = keyof typeof GLYPHS;
type OneId = 'move' | 'budget' | 'beds';
interface Loc { q: string; label: string; display: string }
interface Answers { loc?: Loc; move?: string; budget?: string; beds?: string; hurdles?: string[] }
interface Step { id: 'loc' | OneId | 'hurdles'; kind: 'loc' | 'one' | 'many'; q: string; sub: string; options?: [string, string, Glyph][] }

const STEPS: Step[] = [
  { id: 'loc', kind: 'loc', q: 'Where would you like to live?', sub: 'Let’s start with your city.' },
  {
    id: 'move', kind: 'one', q: 'When are you hoping to move?', sub: 'We’ll keep your timing in mind.',
    options: [['asap', 'As soon as possible', 'bolt'], ['30', 'Within 30 days', 'calendar'], ['90', 'Within 1–3 months', 'clock'], ['exploring', 'Just exploring', 'eye']],
  },
  {
    id: 'budget', kind: 'one', q: 'What’s your monthly rent budget?', sub: 'Let’s focus on places that fit your budget.',
    options: [['u1000', 'Under $1,000', 'coin'], ['1000', '$1,000–$1,500', 'coin'], ['1500', '$1,500–$2,000', 'coin'], ['2000', '$2,000+', 'coin']],
  },
  {
    id: 'beds', kind: 'one', q: 'How many bedrooms do you need?', sub: 'Let’s find a space that feels right.',
    options: [['studio', 'Studio', 'door'], ['1', '1 Bedroom', 'bed'], ['2', '2 Bedrooms', 'bed'], ['3', '3+ Bedrooms', 'home']],
  },
  {
    id: 'hurdles', kind: 'many', q: 'Anything making your apartment search harder?', sub: 'You’re not alone. Select any that apply.',
    options: [
      ['credit', 'Credit concerns', 'chart'], ['eviction', 'Past eviction', 'door'], ['lease', 'Broken lease', 'doc'],
      ['collections', 'Collections or debt', 'coin'], ['income', 'Income or job changes', 'clock'], ['none', 'None of these', 'check'],
      ['prefer', 'Prefer not to say', 'lock'],
    ],
  },
];

/** These can't be combined with anything else. */
const EXCLUSIVE = new Set(['none', 'prefer']);
const LABEL = Object.fromEntries(STEPS.flatMap((s) => (s.options || []).map(([v, l]) => [`${s.id}:${v}`, l])));
const TOTAL = STEPS.length + 1; // + the lead step
const INTRO = ['Hey there.', 'Looking for a place to call home?', 'Your next home could be closer than you think.', 'Let’s find apartments that fit your needs.', 'Just a few quick questions. Ready?'];
const INTRO_MS = 1700;
/** How long the last greeting line stays before the first question appears on its own. */
const INTRO_HOLD_MS = 1500;
const BRIDGE_MS = 1300;
const ZIP = /^\d{5}$/;

type Phase = 'intro' | 'q' | 'bridge' | 'lead' | 'paywall';

/** Saved progress, keeping only values this version of the questionnaire understands. */
function loadAnswers(): Answers {
  const raw = read<Record<string, unknown>>('match', {});
  const a: Answers = {};
  const loc = raw.loc as Partial<Loc> | undefined;
  if (loc && typeof loc.q === 'string' && loc.q.trim() && typeof loc.label === 'string' && typeof loc.display === 'string') {
    a.loc = { q: loc.q.slice(0, 120), label: loc.label.slice(0, 60), display: loc.display.slice(0, 120) };
  }
  for (const s of STEPS) {
    const v = raw[s.id];
    if (s.kind === 'one' && typeof v === 'string' && s.options!.some(([o]) => o === v)) a[s.id as OneId] = v;
  }
  const hurdles = STEPS[STEPS.length - 1].options!.map(([v]) => v);
  if (Array.isArray(raw.hurdles)) {
    const h = raw.hurdles.filter((v): v is string => typeof v === 'string' && hurdles.includes(v));
    if (h.length && (h.length === 1 || !h.some((v) => EXCLUSIVE.has(v)))) a.hurdles = h;
  }
  return a;
}
const answered = (a: Answers, s: Step) => (s.kind === 'many' ? !!a.hurdles?.length : !!a[s.id as 'loc' | OneId]);

/** Analytics that must count once per visit (refreshes and Back never double count). Never pass answers here. */
function trackOnce(key: string, event: FunnelEvent, props?: EventProps) {
  const seen = read<string[]>('match.tracked', [], 'session');
  if (seen.includes(key)) return false;
  write('match.tracked', [...seen, key], 'session');
  track(event, props);
  return true;
}

function bridgeLines(a: Answers): string[] {
  const h = a.hurdles || [];
  const where = a.loc?.label;
  if (h.includes('prefer')) return ['No problem.', 'Let’s focus on what you’re looking for.', 'Your apartment search is almost ready.'];
  if (h.includes('none')) return ['Sounds good.', 'Let’s find places that fit your needs.', where ? `Your ${where} search is almost ready.` : 'Your search is almost ready.'];
  if (h.includes('eviction')) return ['Thanks for sharing.', 'A past eviction doesn’t mean every door is closed.', 'Let’s see what options are worth exploring.'];
  if (h.includes('credit') || h.includes('collections')) return ['Got it.', 'Your credit doesn’t tell your whole story.', where ? `Let’s explore your options in ${where}.` : 'Let’s explore your options.'];
  return ['Thanks for sharing.', 'Your past doesn’t have to decide your next home.', where ? `Let’s explore your options in ${where}.` : 'Let’s explore your options.'];
}

export default function ApartmentMatch() {
  const navigate = useNavigate();
  const { lead, entitlements } = useFunnel();
  const verified = !!entitlements.verified;
  const [answers, setAnswers] = useState<Answers>(loadAnswers);
  const [signIn, setSignIn] = useState(false);
  const skipped = useRef(false);
  const [step, setStep] = useState(() => Math.max(0, STEPS.findIndex((s) => !answered(loadAnswers(), s))));
  const [phase, setPhase] = useState<Phase>(() => {
    const a = loadAnswers();
    if (STEPS.every((s) => answered(a, s))) return lead ? 'paywall' : 'lead';
    // Returning visitors go straight back to their questions.
    return a.loc || read('match.intro', false) ? 'q' : 'intro';
  });
  const headRef = useRef<HTMLHeadingElement>(null);
  const where = useRef({ phase, step });
  where.current = { phase, step };

  useEffect(() => {
    trackOnce('view', 'match_view');
    // Abandonment: leaving after starting but before the lead step is done. Fires at most once per visit.
    const onHide = () => {
      const { phase: ph, step: st } = where.current;
      if (ph === 'paywall' || !read<string[]>('match.tracked', [], 'session').includes('started')) return;
      trackOnce('abandoned', 'match_abandoned', { step: ph === 'q' ? STEPS[st].id : ph });
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [phase, step]);

  // Signed in (the emailed sign-in link lands here, or an earlier purchase) → straight to the apartment listings,
  // on their saved search when there is one. The Finder is a separate app, so this is a full page load.
  useEffect(() => {
    if (skipped.current || !verified) return;
    skipped.current = true;
    trackOnce('signin_skip', 'match_signin_skip');
    window.location.replace(listingsUrl(entitlements.last_search?.place || loadAnswers().loc?.q, !!entitlements.premium?.active));
  }, [verified, entitlements.last_search, entitlements.premium]);

  /** Emails the search link (and remembers the search for sign-in) when the lead step was skipped. */
  async function saveSearch(a: Answers) {
    if (!a.loc) return;
    // The browser remembers the lead but the session cookie may be gone; never replace a signed-in session, though.
    if (!entitlements.signed_in && lead && !(await restoreSession().catch(() => null))) return;
    void emitLifecycle('search_saved', { source: 'match', place: a.loc.q });
  }

  function afterBridge() {
    if (lead || verified) {
      void saveSearch(answers);
      return setPhase('paywall');
    }
    setPhase('lead');
  }

  function start() {
    write('match.intro', true);
    trackOnce('started', 'match_started');
    setPhase('q');
  }

  function advance(next: Answers) {
    const s = STEPS[step];
    trackOnce('started', 'match_started');
    trackOnce(`step:${s.id}`, 'match_step', { step: s.id });
    setAnswers(next);
    write('match', next);
    if (step < STEPS.length - 1) return setStep(step + 1);
    trackOnce('completed', 'match_completed');
    setPhase('bridge');
  }

  function back() {
    if (phase === 'q' && step > 0) return setStep(step - 1);
    if (phase === 'lead' || phase === 'paywall') {
      setStep(STEPS.length - 1);
      return setPhase('q');
    }
    navigate('/');
  }

  const progress = phase === 'intro' ? 0 : phase === 'q' ? step / TOTAL : phase === 'paywall' ? 1 : STEPS.length / TOTAL;

  return (
    <div className="am">
      <Seo title="Find your next apartment | RentReady" description="Answer a few quick questions and start your apartment search, including second-chance apartments. No credit check." />
      <div className="am-glow" aria-hidden="true" />
      <header className="am-top" aria-hidden={signIn || undefined}>
        {phase === 'intro' ? (
          <button type="button" className="am-skip" onClick={start}>Skip</button>
        ) : (
          <button type="button" className="am-icon-btn" onClick={back} aria-label="Back" style={{ visibility: phase === 'bridge' ? 'hidden' : 'visible' }}>
            <Svg glyph="back" />
          </button>
        )}
        <div className="am-progress" role="progressbar" aria-label="Questionnaire progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span style={{ transform: `scaleX(${progress})` }} />
        </div>
        {!verified && phase !== 'paywall' ? (
          <button type="button" className="am-signin" onClick={() => setSignIn(true)} aria-haspopup="dialog">Sign In</button>
        ) : <span />}
        <Link className="am-icon-btn" to="/" aria-label="Close">
          <Svg glyph="close" />
        </Link>
      </header>
      {signIn && <SignInSheet onClose={() => setSignIn(false)} />}

      <div className="am-main" aria-hidden={signIn || undefined}>
      {verified ? (
        <main className="am-stage"><div className="am-body am-center"><p className="am-line am-line-stay am-sweep" aria-live="polite">Taking you to your apartments…</p></div></main>
      ) : phase === 'intro' ? (
        // Wait to know whether they're signed in, so a member doesn't watch the greeting before being sent on.
        entitlements.status !== 'loading' && <Intro onStart={start} />
      ) : null}
      {!verified && phase === 'q' && STEPS[step].kind === 'loc' && <LocationStep key="loc" answers={answers} headRef={headRef} onAnswer={(loc) => advance({ ...answers, loc })} />}
      {!verified && phase === 'q' && STEPS[step].kind !== 'loc' && <Question key={step} step={STEPS[step]} index={step} answers={answers} headRef={headRef} onAnswer={advance} />}
      {!verified && phase === 'bridge' && <Bridge lines={bridgeLines(answers)} onDone={afterBridge} />}
      {!verified && phase === 'lead' && <LeadStep answers={answers} headRef={headRef} onDone={() => setPhase('paywall')} />}
      {!verified && phase === 'paywall' && <Paywall answers={answers} headRef={headRef} />}
      </div>
    </div>
  );
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Greeting lines fade in and out, then the first question appears on its own. Tap anywhere (or Skip) to start now. */
function Intro({ onStart }: { onStart: () => void }) {
  const [i, setI] = useState(() => (reducedMotion() ? INTRO.length - 1 : 0));
  const go = useRef(onStart);
  go.current = onStart;
  const last = i === INTRO.length - 1;
  useEffect(() => {
    const t = window.setTimeout(() => (last ? go.current() : setI(i + 1)), last ? INTRO_HOLD_MS : INTRO_MS);
    return () => window.clearTimeout(t);
  }, [i, last]);
  return (
    <main className="am-stage" onClick={() => go.current()}>
      <div className="am-body am-center">
        <p key={i} className={`am-line am-sweep${last ? ' am-line-stay' : ''}`} style={{ ['--am-dur' as string]: `${INTRO_MS}ms` }} aria-live="polite">{INTRO[i]}</p>
      </div>
      <div className="am-foot am-foot-intro">
        <p className="am-fine">No credit check. Takes about a minute.</p>
      </div>
    </main>
  );
}

/** The personal transition after the last question: about four seconds, then on by itself (tap to move on now). */
function Bridge({ lines, onDone }: { lines: string[]; onDone: () => void }) {
  const [i, setI] = useState(() => (reducedMotion() ? lines.length - 1 : 0));
  const done = useRef(onDone);
  done.current = onDone;
  const last = i === lines.length - 1;
  useEffect(() => {
    const t = window.setTimeout(() => (last ? done.current() : setI(i + 1)), BRIDGE_MS);
    return () => window.clearTimeout(t);
  }, [i, last]);
  return (
    <main className="am-stage" onClick={() => done.current()}>
      <div className="am-body am-center">
        <p key={i} className={`am-line am-sweep${last ? ' am-line-stay' : ''}`} style={{ ['--am-dur' as string]: `${BRIDGE_MS}ms` }} aria-live="polite">{lines[i]}</p>
      </div>
    </main>
  );
}

/** The small "Next" that confirms each answer. */
function NextButton({ disabled, busy, busyLabel = 'Checking', note }: { disabled?: boolean; busy?: boolean; busyLabel?: string; note?: ReactNode }) {
  return (
    <div className="am-foot am-foot-next">
      {note && <p className="am-fine">{note}</p>}
      <button className="am-next" type="submit" disabled={disabled || busy} aria-busy={busy}>
        {busy ? <><Spinner /> {busyLabel}</> : <>Next <Svg glyph="next" /></>}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- location
interface Suggestion { placeId: string; primaryText: string; secondaryText: string }

/**
 * Location suggestions from RentReady Finder's own endpoint (the same Google Places autocomplete the Finder search uses).
 * Returns null when the service can't be reached, so the step can still accept a plain city or ZIP.
 */
async function lookupPlaces(q: string, signal?: AbortSignal): Promise<Suggestion[] | null> {
  try {
    const r = await fetch(`/finder/api/locations/autocomplete?q=${encodeURIComponent(q)}`, { signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const d: unknown = await r.json();
    return Array.isArray(d) ? (d as Suggestion[]).filter((s) => s && typeof s.primaryText === 'string').slice(0, 5) : null;
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return null;
  }
}

const region = (s: Suggestion) => (s.secondaryText || '').replace(/,?\s*(USA|United States)$/i, '').trim();

function fromSuggestion(s: Suggestion): Loc {
  const r = region(s);
  if (ZIP.test(s.primaryText.trim())) {
    const zip = s.primaryText.trim();
    return { q: r ? `${zip}, ${r}` : zip, label: r.split(',')[0] || `ZIP ${zip}`, display: r ? `${zip} · ${r}` : `ZIP ${zip}` };
  }
  const display = r ? `${s.primaryText}, ${r}` : s.primaryText;
  return { q: display, label: s.primaryText, display };
}

/** The Finder, on this search area when we know it; members open on verified second-chance listings. */
function listingsUrl(place: string | undefined, premium: boolean) {
  const p = new URLSearchParams();
  if (premium) p.set('mode', 'second-chance');
  if (place) p.set('q', place);
  const q = p.toString().replace(/\+/g, '%20');
  return `/finder/${q ? `?${q}` : ''}`;
}

/** When suggestions are unavailable: a 5-digit ZIP stays a ZIP (never shown as a city); otherwise it must look like a place name. */
function fallbackLoc(t: string): Loc | null {
  if (ZIP.test(t)) return { q: t, label: `ZIP ${t}`, display: `ZIP ${t}` };
  if (!/^[\p{L}][\p{L} .'-]*(,\s*[\p{L}][\p{L} .'-]*)?$/u.test(t)) return null;
  return { q: t, label: t.split(',')[0].trim(), display: t };
}

function LocationStep({ answers, headRef, onAnswer }: { answers: Answers; headRef: RefObject<HTMLHeadingElement>; onAnswer: (l: Loc) => void }) {
  const [text, setText] = useState(answers.loc?.display || '');
  const [picked, setPicked] = useState<Loc | null>(answers.loc || null);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const typed = useRef(false);

  // Suggestions only for the visitor's own typing (each lookup is a paid Google request), debounced, newest wins.
  useEffect(() => {
    const t = text.trim();
    if (!typed.current || t.length < 2 || picked?.display === text) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      lookupPlaces(t, ctrl.signal).then((r) => {
        setItems(r || []);
        setActive(-1);
        setOpen(true);
      }, () => undefined);
    }, 280);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, picked]);

  function choose(s: Suggestion) {
    const loc = fromSuggestion(s);
    setPicked(loc);
    setText(loc.display);
    setOpen(false);
    setError('');
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (picked && text === picked.display) return onAnswer(picked);
    const t = sanitizeText(text, 80);
    if (t.length < 2) return setError('Enter a city or a 5-digit ZIP code.');
    if (/^\d+$/.test(t) && !ZIP.test(t)) return setError('ZIP codes have 5 digits.');
    setBusy(true);
    setError('');
    const res = await lookupPlaces(t).catch(() => null);
    setBusy(false);
    if (res === null) {
      const loc = fallbackLoc(t);
      return loc ? onAnswer(loc) : setError('Try a city and state, like Charlotte, NC, or a ZIP code.');
    }
    const zip = ZIP.test(t);
    const first = t.split(',')[0].trim().toLowerCase();
    const match = zip ? res.find((s) => s.primaryText.includes(t)) : res.find((s) => s.primaryText.toLowerCase().startsWith(first));
    if (match) return onAnswer(fromSuggestion(match));
    if (res.length && !zip) {
      setItems(res);
      setOpen(true);
      return setError('Choose your city from the list.');
    }
    setError(zip ? 'We couldn’t find that ZIP code. Check it, or enter a city.' : 'We couldn’t find that place. Try a city and state, like Charlotte, NC.');
  }

  const showList = open && items.length > 0;
  return (
    <form className="am-stage" onSubmit={submit} noValidate>
      <div className="am-body">
        <p className="am-kicker">Question 1 of {STEPS.length}</p>
        <h1 ref={headRef} tabIndex={-1} className="am-q am-sweep">{STEPS[0].q}</h1>
        <p className="am-sub">{STEPS[0].sub}</p>
        <div className="am-field am-combo">
          <label className="sr-only" htmlFor="am-loc">City or ZIP code</label>
          <input
            id="am-loc" className="am-input" value={text} maxLength={80} autoComplete="off" placeholder="Enter city or ZIP code" autoFocus
            role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls="am-loc-list"
            aria-activedescendant={showList && active >= 0 ? `am-loc-${active}` : undefined}
            aria-invalid={!!error} aria-describedby={error ? 'am-loc-err' : undefined}
            onChange={(e) => { typed.current = true; setText(e.target.value); setPicked(null); setError(''); }}
            onKeyDown={onKey}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onFocus={() => items.length && setOpen(true)}
          />
          {showList && (
            <ul id="am-loc-list" role="listbox" className="am-list" aria-label="Suggested places">
              {items.map((s, n) => (
                <li
                  key={s.placeId || n} id={`am-loc-${n}`} role="option" aria-selected={n === active} className="am-list-item"
                  onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s)}
                >
                  <Svg glyph="pin" />
                  <span><strong>{s.primaryText}</strong>{s.secondaryText && <small>{region(s) || s.secondaryText}</small>}</span>
                </li>
              ))}
            </ul>
          )}
          {error && <p id="am-loc-err" className="am-error" role="alert">{error}</p>}
        </div>
      </div>
      <NextButton disabled={!text.trim()} busy={busy} />
    </form>
  );
}

// ---------------------------------------------------------------- choice questions
function Question({ step, index, answers, headRef, onAnswer }: { step: Step; index: number; answers: Answers; headRef: RefObject<HTMLHeadingElement>; onAnswer: (a: Answers) => void }) {
  const [picked, setPicked] = useState<string[]>(answers.hurdles || []);
  const [chosen, setChosen] = useState<string | undefined>(step.kind === 'one' ? answers[step.id as OneId] : undefined);

  function toggle(v: string) {
    setPicked((p) => (EXCLUSIVE.has(v) ? (p.includes(v) ? [] : [v]) : p.includes(v) ? p.filter((x) => x !== v) : [...p.filter((x) => !EXCLUSIVE.has(x)), v]));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (step.kind === 'one') return chosen && onAnswer({ ...answers, [step.id]: chosen });
    if (picked.length) onAnswer({ ...answers, hurdles: picked });
  }

  return (
    <form className="am-stage" onSubmit={submit} noValidate>
      <div className="am-body">
        <p className="am-kicker">Question {index + 1} of {STEPS.length}</p>
        <h1 ref={headRef} tabIndex={-1} className="am-q am-sweep">{step.q}</h1>
        <p className="am-sub">{step.sub}</p>
        <div className="am-opts" role={step.kind === 'one' ? 'radiogroup' : 'group'} aria-label={step.q}>
          {step.options!.map(([v, label, glyph], n) => {
            const on = step.kind === 'one' ? chosen === v : picked.includes(v);
            return (
              <button
                key={v} type="button" className="am-opt" style={{ ['--i' as string]: n }}
                role={step.kind === 'one' ? 'radio' : undefined} aria-checked={step.kind === 'one' ? on : undefined} aria-pressed={step.kind === 'many' ? on : undefined}
                onClick={() => (step.kind === 'one' ? setChosen(v) : toggle(v))}
              >
                <Svg glyph={glyph} />
                <span>{label}</span>
                {on && <span className="am-opt-tick"><Svg glyph="check" /></span>}
              </button>
            );
          })}
        </div>
      </div>
      <NextButton
        disabled={step.kind === 'one' ? !chosen : !picked.length}
        note={step.kind === 'many' && <><Svg glyph="lock" /> Your answers are private and won’t affect your credit.</>}
      />
    </form>
  );
}

// ---------------------------------------------------------------- lead
function LeadStep({ answers, headRef, onDone }: { answers: Answers; headRef: RefObject<HTMLHeadingElement>; onDone: () => void }) {
  const { lead, setLead } = useFunnel();
  const [firstName, setFirstName] = useState(lead?.first_name || '');
  const [email, setEmail] = useState(lead?.email || '');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<{ firstName?: string; email?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const optInLabel = 'Also send me apartment tips and RentReady updates. Optional — unsubscribe anytime.';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs = { firstName: validateFirstName(firstName) || undefined, email: validateEmail(email) || undefined };
    setErrors(errs);
    if (errs.firstName) return nameRef.current?.focus();
    if (errs.email) return emailRef.current?.focus();
    setBusy(true);
    try {
      // Same email → same lead (the server upserts by email); marketing consent is only ever raised by the checkbox.
      const l = await captureLead({
        firstName, email,
        emailConsent: consent,
        consentBasis: 'checkbox',
        consentText: consent ? optInLabel : 'Asked for a search link at the apartment-match questionnaire. Marketing email not selected.',
        source: 'match',
        productInterest: 'premium',
      });
      setLead(l);
      if (trackOnce('lead', 'lead_captured', { cta_location: 'match', product: 'premium' })) reportAdsConversion('lead');
      void emitLifecycle('lead_captured', { source: 'match', product: 'premium' });
      if (answers.loc) void emitLifecycle('search_saved', { source: 'match', place: answers.loc.q });
      onDone();
    } catch (err) {
      setErrors({ form: err instanceof ApiError ? err.message : 'We couldn’t save that just now. Check your connection and try again.' });
      setBusy(false);
    }
  }

  return (
    <form className="am-stage" onSubmit={submit} noValidate>
      <div className="am-body">
        <p className="am-kicker">Last step</p>
        <h1 ref={headRef} tabIndex={-1} className="am-q am-sweep">Your apartment search is almost ready.</h1>
        <p className="am-sub">Where can we send your search link?</p>
        {errors.form && <p className="am-error am-error-block" role="alert">{errors.form}</p>}
        <div className="am-field">
          <label htmlFor="am-fn">First Name</label>
          <input ref={nameRef} id="am-fn" className="am-input" value={firstName} maxLength={40} autoComplete="given-name" onChange={(e) => setFirstName(e.target.value)} aria-invalid={!!errors.firstName} aria-describedby={errors.firstName ? 'am-fn-err' : undefined} />
          {errors.firstName && <p id="am-fn-err" className="am-error">{errors.firstName}</p>}
        </div>
        <div className="am-field" style={{ ['--i' as string]: 1 }}>
          <label htmlFor="am-em">Email Address</label>
          <input ref={emailRef} id="am-em" className="am-input" type="email" inputMode="email" value={email} maxLength={254} autoComplete="email" onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'am-em-err' : undefined} />
          {errors.email && <p id="am-em-err" className="am-error">{errors.email}</p>}
        </div>
        <label className="am-check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{optInLabel}</span>
        </label>
      </div>
      <NextButton busy={busy} busyLabel="Saving" note="No credit check. No application fee to search. We never sell your email." />
    </form>
  );
}

// ---------------------------------------------------------------- sign in
/** "Already did this?" — emails a one-time sign-in link that lands back here, signed in, on their saved search. */
function SignInSheet({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState(() => read<{ email?: string } | null>('lead', null)?.email || '');
  const [error, setError] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state === 'sending') return;
    const v = validateEmail(email);
    if (v) {
      setError(v);
      return inputRef.current?.focus();
    }
    setError('');
    setState('sending');
    track('match_signin_requested');
    try {
      if (!isMock) await requestSignInLink(email.trim(), '/find-my-apartment');
      setState('sent');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="am-sheet-wrap" onClick={onClose}>
      <div className="am-sheet" role="dialog" aria-modal="true" aria-labelledby="am-si-h" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="am-icon-btn am-sheet-x" onClick={onClose} aria-label="Close sign in"><Svg glyph="close" /></button>
        {state === 'sent' ? (
          <div aria-live="polite">
            <h2 id="am-si-h" className="am-sheet-h">Check your email</h2>
            <p className="am-sheet-sub">If <strong>{email.trim()}</strong> has a RentReady account, we just sent a sign-in link. Open it to go straight to your apartment listings. It works once and expires in 30 minutes.</p>
            {isMock && <p className="am-fine">Development mode — no email is sent.</p>}
            <div className="am-sheet-actions">
              <button type="button" className="am-btn" onClick={onClose}>Back to questions</button>
              <button type="button" className="am-link" onClick={() => setState('idle')}>Use a different email</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h2 id="am-si-h" className="am-sheet-h">Welcome back</h2>
            <p className="am-sheet-sub">Already have an account? Enter your email and we’ll send you a link that takes you straight to your apartment listings. No password needed.</p>
            <div className="am-field">
              <label htmlFor="am-si-em">Email Address</label>
              <input ref={inputRef} id="am-si-em" className="am-input" type="email" inputMode="email" autoComplete="email" maxLength={254} value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'am-si-err' : undefined} />
              {error && <p id="am-si-err" className="am-error" role="alert">{error}</p>}
            </div>
            {state === 'failed' && <p className="am-error am-error-block" role="alert">We couldn’t send that just now. Please try again.</p>}
            <div className="am-sheet-actions">
              <button type="submit" className="am-btn" disabled={state === 'sending'} aria-busy={state === 'sending'}>
                {state === 'sending' ? <><Spinner /> Sending</> : 'Email Me a Sign-In Link'}
              </button>
              <button type="button" className="am-link" onClick={onClose}>New here? Answer the questions</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- premium offer
/** What Premium unlocks: [bold title, description]. */
const UNLOCKS: [string, string][] = [
  ['Find Apartments That May Fit Your Situation', 'Explore second-chance listings and properties with more flexible rental requirements.'],
  ['Know Before You Apply', 'Review available screening information so you can make a smarter decision before paying application fees.'],
  ['Discover More Rental Opportunities', 'Access additional property listings, photos, prices, locations, and contact details.'],
  ['Never Miss a New Opportunity', 'Save your searches and get notified when new matching apartments become available.'],
  ['Stay in Control', 'Manage your Premium membership online and cancel anytime.'],
];

const longDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function Paywall({ answers, headRef }: { answers: Answers; headRef: RefObject<HTMLHeadingElement> }) {
  const { entitlements, firstName } = useFunnel();
  const [offer, setOffer] = useState<PremiumOffer | null>(null);
  const [offerError, setOfferError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadOffer = useCallback(() => {
    setOfferError(false);
    fetchPremiumOffer().then(setOffer, () => setOfferError(true));
  }, []);
  useEffect(() => {
    trackOnce('paywall', 'paywall_view', { product: 'premium', cta_location: 'match' });
    loadOffer();
  }, [loadOffer]);

  const loc = answers.loc;
  const active = !!entitlements.premium?.active || !!offer?.active;
  const q = loc ? `q=${encodeURIComponent(loc.q)}` : '';
  const searchTo = `/finder/?mode=second-chance${q ? `&${q}` : ''}`;
  const freeTo = `/finder/${q ? `?${q}` : ''}`;
  const pills = [loc?.display, answers.budget && LABEL[`budget:${answers.budget}`], answers.beds && LABEL[`beds:${answers.beds}`], answers.move && LABEL[`move:${answers.move}`]].filter(Boolean) as string[];
  const trial = !!offer && offer.trial_days > 0;
  const firstBill = offer ? longDate(new Date(Date.now() + offer.trial_days * 86400000)) : '';
  const price = offer ? money(offer.price_cents) : '';

  async function join() {
    if (!offer || busy) return;
    setBusy(true);
    setError('');
    track('primary_cta_click', { cta_location: 'match_paywall', product: 'premium' });
    try {
      await startPremium(searchTo, trial ? 'trial' : undefined);
    } catch (e) {
      setBusy(false);
      setError(e instanceof ApiError ? e.message : 'Checkout didn’t open. Please try again.');
    }
  }

  return (
    <main className="am-stage am-pay">
      <div className="am-body">
        <p className="am-kicker">{firstName ? `${firstName}, you’re all set` : 'You’re all set'}</p>
        <h1 ref={headRef} tabIndex={-1} className="am-q am-sweep">{loc ? `Your ${loc.label} apartment search is ready.` : 'Your apartment search is ready.'}</h1>
        <ul className="am-pills" aria-label="Your search">{pills.map((p) => <li key={p}>{p}</li>)}</ul>

        <section className="am-plan" aria-labelledby="am-plan-h">
          {active ? (
            <>
              <h2 id="am-plan-h" className="am-plan-h">Your Premium listings are unlocked.</h2>
              <p className="am-plan-sub">You’re a RentReady Premium member, so second-chance listing details are already open to you.</p>
            </>
          ) : (
            <>
              <h2 id="am-plan-h" className="am-plan-h">Stop Guessing Which Apartments Will Give You a Chance.</h2>
              <p className="am-plan-hook">Bad credit? Past eviction? Been denied before? You may have more options than you think.</p>
              <p className="am-plan-sub">Unlock access to additional apartment listings, including second-chance options, and see what properties may look for before you spend money applying.</p>
              <p className="am-plan-label">Here’s what RentReady Premium unlocks:</p>
              <ul className="am-checks">
                {UNLOCKS.map(([title, text]) => (
                  <li key={title}><Svg glyph="check" /><span><strong>{title}</strong> — {text}</span></li>
                ))}
              </ul>
              <p className="am-plan-close">Your next home starts with knowing where to look.</p>
              {offerError ? (
                <div className="am-terms am-terms-error" role="alert">
                  <p>We couldn’t load membership pricing.</p>
                  <button type="button" className="am-link" onClick={loadOffer}>Try again</button>
                </div>
              ) : !offer ? (
                <div className="am-terms" aria-busy="true"><p className="am-fine"><Spinner /> Loading membership terms…</p></div>
              ) : (
                <div className="am-terms">
                  <dl>
                    <div><dt>Due today</dt><dd className="am-due">{money(offer.due_today_cents)}</dd></div>
                    {trial && <div><dt>Free trial</dt><dd>{offer.trial_days} days</dd></div>}
                    <div><dt>Then</dt><dd>{price}/month{trial ? `, starting ${firstBill}` : ''}</dd></div>
                  </dl>
                  <p className="am-terms-note">
                    {trial
                      ? `Cancel anytime before ${firstBill} and you won’t be charged. After that, it renews monthly until you cancel — you keep access until the end of the month you paid for.`
                      : 'Renews monthly until you cancel. Cancel anytime — you keep access until the end of the month you paid for.'}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
        {error && <p className="am-error am-error-block" role="alert">{error}</p>}
      </div>

      <div className="am-foot">
        {active ? (
          <a className="am-btn" href={searchTo}>See apartments in {loc?.label || 'your area'}</a>
        ) : (
          <>
            <button type="button" className="am-btn" onClick={join} disabled={busy || !offer || isMock} aria-busy={busy}>
              {busy ? <><Spinner /> Opening secure checkout…</> : 'Unlock My Apartment Options'}
            </button>
            {offer && (
              <p className="am-fine">
                <Svg glyph="lock" /> Secure checkout by Stripe. {trial ? `Card required. ${money(0)} today; first charge ${firstBill}.` : `You’ll be charged ${price} today.`}
              </p>
            )}
            {isMock && <p className="am-fine">Membership checkout runs on the live site.</p>}
            <a className="am-btn am-btn-ghost" href={freeTo} onClick={() => track('primary_cta_click', { cta_location: 'match_paywall_free' })}>Continue With Free Search</a>
          </>
        )}
        <p className="am-fine am-legal">
          <em>No credit check to search. Approval and availability depend on each property.</em> <Link to="/premium#terms">Membership terms</Link>
        </p>
      </div>
    </main>
  );
}

const GLYPHS = {
  back: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  next: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 018 0v2.5" /></>,
  pin: <><path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0113 0c0 4.8-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  bolt: <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />,
  calendar: <><rect x="4" y="5.5" width="16" height="15" rx="2.5" /><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  coin: <><circle cx="12" cy="12" r="8.5" /><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8M12 16v1.5" /></>,
  door: <><path d="M6 20.5V4.5a1 1 0 011-1h10a1 1 0 011 1v16" /><path d="M3.5 20.5h17M14.5 12.5v.5" /></>,
  bed: <><path d="M3 18.5v-11M3 14.5h18v4M21 14.5v-2.5a3 3 0 00-3-3h-7v5.5" /><circle cx="7" cy="11.5" r="1.8" /></>,
  home: <><path d="M3.5 11L12 4l8.5 7" /><path d="M6 9.5v10h12v-10" /></>,
  chart: <path d="M4 19.5h16M7 16v-4M12 16V8M17 16v-6" />,
  doc: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
} satisfies Record<string, ReactNode>;

function Svg({ glyph }: { glyph: Glyph }) {
  return (
    <svg className="am-svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[glyph]}
    </svg>
  );
}
