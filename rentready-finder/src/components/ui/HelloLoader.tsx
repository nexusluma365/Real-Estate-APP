import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

export interface Phrase {
  text: string;
  sub?: string;
}

const ease = [0.22, 0.61, 0.36, 1] as const;
const FADE = 0.45; // seconds for a phrase to leave, and again for the next to arrive
/** How long a phrase sits fully visible: long enough to read, short enough to feel alive. */
const holdMs = (p: Phrase) => 450 + Math.min(700, (p.text.length + (p.sub?.length ?? 0)) * 20);
/** A phrase's whole turn, measured from when the previous one starts leaving. */
const cycleMs = (p: Phrase) => holdMs(p) + FADE * 2000;

/**
 * One phrase at a time, iPhone-setup style: fades in from a soft blur, a light sweep flashes across it,
 * then it dissolves into the next. `loop` cycles forever (search in progress); otherwise `onDone` fires after the last.
 */
function HelloSequence({ phrases, loop = false, onDone, large = true }: { phrases: Phrase[]; loop?: boolean; onDone?: () => void; large?: boolean }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (i < phrases.length - 1) setI(i + 1);
      else if (loop) setI(0);
      else done.current?.();
    }, cycleMs(phrases[i]));
    return () => window.clearTimeout(t);
  }, [i, loop, phrases]);

  const p = phrases[i];
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${i}-${p.text}`}
        initial={reduce ? { opacity: 0 } : { opacity: 0, filter: 'blur(16px)', y: 14, scale: 0.97 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, filter: 'blur(0px)', y: 0, scale: 1 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, filter: 'blur(10px)', y: -10, scale: 1.02 }}
        transition={{ duration: FADE, ease }}
        className="px-6 text-center"
      >
        <p
          data-text={p.text}
          className={`hello-text hello-flash mx-auto max-w-[14ch] font-semibold leading-[1.04] tracking-[-0.035em] ${large ? 'text-[36px] sm:text-[60px] lg:text-[76px]' : 'text-[26px] sm:text-[40px]'}`}
        >
          {p.text}
        </p>
        {p.sub ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className={`mt-4 font-medium tracking-[0.02em] text-white/70 ${large ? 'text-[17px] sm:text-[20px]' : 'text-[15px]'}`}
          >
            {p.sub}
          </motion.p>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}

function Aurora() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="hello-aurora hello-aurora--gold left-[8%] top-[18%] h-[42vmin] w-[42vmin]" />
      <span className="hello-aurora hello-aurora--blue right-[6%] top-[30%] h-[48vmin] w-[48vmin]" />
      <span className="hello-aurora hello-aurora--violet bottom-[4%] left-[34%] h-[40vmin] w-[40vmin]" />
    </div>
  );
}

const INTRO: Phrase[] = [
  { text: 'Hey!' },
  { text: 'Welcome to RentReady Finder' },
  { text: 'We’re searching apartments', sub: 'Hang tight…' },
  { text: 'Let’s get to know each other' },
];
const SEEN_KEY = 'rr-finder-intro-seen';
const introTotal = INTRO.reduce((ms, p) => ms + cycleMs(p), 0);

function alreadySeen() {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Full-screen welcome shown once per browser session while the Finder loads. Skippable. */
export function IntroLoader() {
  const [show, setShow] = useState(() => !alreadySeen());
  const reduce = useReducedMotion();

  const finish = () => {
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* storage unavailable — the intro simply shows again next load */
    }
    setShow(false);
  };

  useEffect(() => {
    if (!show) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [show]);

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="intro"
          role="status"
          aria-live="polite"
          aria-label="Loading RentReady Finder"
          initial={{ opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04, filter: 'blur(8px)' }}
          transition={{ duration: 0.7, ease }}
          className="hello-stage fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
        >
          <Aurora />
          <div className="relative">
            <HelloSequence phrases={INTRO} onDone={finish} />
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-6 px-6 pb-[calc(24px+env(safe-area-inset-bottom))] sm:px-10">
            <div className="h-[2px] w-full max-w-[220px] overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <motion.div className="hello-bar h-full origin-left" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: introTotal / 1000, ease: 'linear' }} />
            </div>
            <button
              type="button"
              onClick={finish}
              className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[13px] font-semibold text-white/80 backdrop-blur-md transition-colors hover:bg-white/15 hover:text-white"
            >
              Skip
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Inline version for a search in progress: loops until the results arrive. */
export function SearchLoader({ label }: { label: string }) {
  const phrases: Phrase[] = [
    { text: 'We’re searching apartments', sub: `Looking near ${label}` },
    { text: 'Hang tight…', sub: 'Gathering apartment communities for you' },
  ];
  return (
    <div role="status" aria-live="polite" className="hello-stage relative mt-8 flex min-h-[320px] items-center justify-center overflow-hidden rounded-[28px] shadow-float">
      <span className="sr-only">Searching apartments near {label}</span>
      <Aurora />
      <div className="relative" aria-hidden="true">
        <HelloSequence phrases={phrases} loop large={false} />
      </div>
    </div>
  );
}
