import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { BookVisual } from '../components/BookVisual';
import { CtaLink, StickyCta, useOnce } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import type { Intent } from '../config/intents';
import { env } from '../lib/env';
import { captureAttribution } from '../lib/attribution';
import { track } from '../lib/analytics';
import { BuyFaqList, Options, QualifyQuiz, TrustBar } from '../components/Funnel';
import { buyFaq, LANDING_FAQ } from '../config/faq';
import { PRODUCTS } from '../config/products';
import { SITE } from '../config/site';
import type { Recommendation } from '../config/qualification';

/**
 * Home page — "Before They Say No™" for high-intent Google Search traffic (worried about being denied).
 * Story: hero → who it's for → the core problem → what the book does → short story → before/after →
 * what's inside → the big transformation → real urgency → final CTA.
 * Conversion layer: trust bar → 3-question finder (skippable) → side-by-side options →
 * objection FAQ → honest promise → free checklist for visitors who aren't ready (exit offer + final band).
 * Every section answers one question; every CTA leads to a purchase or a genuinely useful next step.
 *
 * Purchase paths (both already supported by checkout; buyers can switch there):
 *   - Before They Say No™, the physical book → /checkout?product=guide   ← the primary action
 *   - RentReady Digital Bundle (book + digital toolkit + video guide) → /checkout?product=creditready
 * Pricing is shown at checkout before payment. Hope through preparation; never promises approval.
 */
const BOOK_TO = '/checkout?product=guide';
const BUNDLE_TO = '/checkout?product=creditready';
const VARIANT = 'book-before-they-say-no';
/** Money-back window (VITE_MONEY_BACK_DAYS). 0 hides the guarantee everywhere on this page. */
const GUARANTEE_DAYS = env.moneyBackDays;

/** Fades sections in as they enter the viewport. Content stays visible without IntersectionObserver. */
function useReveal() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const els = root.current?.querySelectorAll<HTMLElement>('[data-reveal]');
    if (!els?.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-in'));
      return;
    }
    root.current?.classList.add('bk-animate');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        io.unobserve(en.target);
      }),
      { rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return root;
}

const delay = (ms: number) => ({ ['--d' as string]: `${ms}ms` }) as CSSProperties;

const Arrow = () => <span className="bk-arrow" aria-hidden="true">→</span>;

/** Primary buy action (the book) + a visible but secondary Digital Bundle option. */
function BuyBlock({ location, label = 'Get the Book', note = 'Physical book · ships to you', center = false }: { location: string; label?: ReactNode; note?: string; center?: boolean }) {
  return (
    <div className={`bk-buy${center ? ' bk-buy-center' : ''}`}>
      <CtaLink to={BOOK_TO} className="btn bk-btn" props={{ cta_location: location, product: 'guide', variant: VARIANT }}>
        {label} <Arrow />
      </CtaLink>
      <p className="bk-buy-note"><Icon name="home" />{note}</p>
      <p className="bk-buy-alt">
        Want the dispute letters and videos too?{' '}
        <CtaLink to={BUNDLE_TO} className="bk-link" props={{ cta_location: `${location}_bundle`, product: 'creditready', variant: VARIANT }}>
          Get the Digital Bundle.
        </CtaLink>{' '}
        The physical book is included with the Digital Bundle, along with 20 dispute letters and a video guide.
      </p>
    </div>
  );
}

/** A visual progression, e.g. See → Identify → Prepare → Apply. */
function Chain({ steps, className = '' }: { steps: string[]; className?: string }) {
  return (
    <p className={`bk-chain ${className}`} aria-label={steps.join(', then ')}>
      {steps.map((s, i) => (
        <Fragment key={s}>
          {i > 0 && <span className="bk-chain-arrow" aria-hidden="true">→</span>}
          <span className="bk-chain-step">{s}</span>
        </Fragment>
      ))}
    </p>
  );
}

/** Purchase reassurance. Only claims that are true in this codebase. */
function Assurance({ className = '' }: { className?: string }) {
  return (
    <ul className={`bk-assure ${className}`}>
      <li><Icon name="lock" />Secure checkout</li>
      <li><Icon name="card" />One-time purchase</li>
      {GUARANTEE_DAYS > 0 && <li><Icon name="shield" />{GUARANTEE_DAYS}-day money-back guarantee</li>}
    </ul>
  );
}

/** "What we promise / what we won't" — trust through candor. */
const PROMISE: { icon: IconName; title: string; body: string }[] = [
  { icon: 'shield', title: 'Straight answers', body: 'No approval guarantees, no “delete anything” claims. Just what screening may look at and how to prepare for it.' },
  { icon: 'card', title: 'One price, once', body: 'A one-time purchase. No subscription, no monthly fees, no surprise charges.' },
  {
    icon: 'check',
    title: GUARANTEE_DAYS > 0 ? `${GUARANTEE_DAYS} days to decide` : 'Real support',
    body: GUARANTEE_DAYS > 0 ? `If it isn’t useful to you, email us within ${GUARANTEE_DAYS} days for a full refund.` : 'Questions about your order? Email us and a person will answer.',
  },
];

const PROBLEMS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'chart', title: 'Bad Credit', body: 'You’re worried your credit score could cause an automatic denial.' },
  { icon: 'alert', title: 'Collections', body: 'Old accounts, charge-offs, or collections may still be following you.' },
  { icon: 'home', title: 'Past Rental Problems', body: 'An old landlord issue, eviction, balance, or rental history problem could raise questions.' },
  { icon: 'doc', title: 'Previous Denials', body: 'You’ve already heard “no” before — and don’t want to keep paying application fees without understanding why.' },
];

const YOU_SEE = ['The bedroom', 'The kitchen', 'The neighborhood', 'The commute', 'The schools', 'Where your furniture will go'];
const THEY_SEE = ['Credit', 'Collections', 'Rental history', 'Income', 'Screening information', 'Outstanding balances', 'Application details'];

const STEPS: { n: string; tag: string; title: string; body: string }[] = [
  { n: '01', tag: 'See', title: 'Understand what they may see.', body: 'Learn the common information property managers and screening companies may consider when reviewing an application.' },
  { n: '02', tag: 'Identify', title: 'Find what may be standing in your way.', body: 'Understand potential red flags and areas that may deserve your attention before applying.' },
  { n: '03', tag: 'Prepare', title: 'Strengthen what you can.', body: 'Learn practical steps for improving your credit position, organizing your application, and preparing for common rental requirements.' },
  { n: '04', tag: 'Apply', title: 'Walk in better prepared.', body: 'Stop guessing and approach your next application with a clearer strategy and more confidence.' },
];

const BEFORE = [
  '“I hope my credit is good enough.”',
  '“I don’t know what they’ll find.”',
  '“I don’t know why I was denied before.”',
  '“Maybe I’ll just apply and see what happens.”',
  'Paying application fees without a clear strategy.',
];
const AFTER = [
  'Understand common screening factors.',
  'Identify possible problems before applying.',
  'Know which areas you may be able to improve.',
  'Prepare supporting information and documentation.',
  'Approach the application with a clearer plan.',
];

/** Accurate, hedged: not every rental check is a hard pull, and impact varies by person and scoring model. */
const INQ_RISKS = [
  'Some rental applications run a hard credit check — and each hard inquiry can lower your score.',
  'Hard inquiries can stay on your credit report for up to two years.',
  'Apply to several places, and you may collect several inquiries — plus several application fees.',
  'A denial doesn’t erase the inquiry. It can stay even if you don’t get the home.',
  'More recent inquiries can make your next application look riskier to the next property manager.',
];
const INQ_HELPS = [
  'Know where you stand before anyone pulls your credit.',
  'Ask whether the property runs a hard or soft check — before you apply.',
  'Apply where your application better fits the criteria, instead of everywhere at once.',
  'Fewer blind applications can mean fewer inquiries and fewer wasted fees.',
  'Strengthen your application while protecting your credit.',
];

const INSIDE: { icon: IconName; title: string; body: string }[] = [
  { icon: 'eye', title: 'What Property Managers May See', body: 'Understand common screening factors and what can influence an application.' },
  { icon: 'chart', title: 'Understanding Your Credit', body: 'Learn what may be hurting your credit position and where to begin improving it.' },
  { icon: 'alert', title: 'Collections & Negative Accounts', body: 'Understand how negative items can affect your application and what options may be available.' },
  { icon: 'home', title: 'Rental History', body: 'Learn how previous rental problems may affect future applications.' },
  { icon: 'doc', title: 'Preparing Your Application', body: 'Know what documents and information to have ready.' },
  { icon: 'compass', title: 'Turning Denials Into a Plan', body: 'Instead of simply hearing “no,” understand what to investigate and improve before trying again.' },
];

export default function Landing({ intent }: { intent?: Intent }) {
  const { search, pathname } = useLocation();
  const root = useReveal();
  const variant = intent?.hero.id || VARIANT;
  useOnce(() => { captureAttribution(search, pathname, intent?.slug); track('landing_view', { variant }); });
  const [rec, setRec] = useState<Recommendation | undefined>();
  const faq = useMemo(() => {
    const base = buyFaq({
      guidePrice: PRODUCTS.guide.priceLabel,
      bundlePrice: PRODUCTS.creditready.priceLabel,
      upgradePrice: PRODUCTS.upgrade.priceLabel,
      refundDays: GUARANTEE_DAYS,
      deliveryNote: env.physicalDeliveryNote,
      supportEmail: SITE.supportEmail,
    });
    // Intent pages lead with the answers their searchers came for.
    const first = (intent?.faqFirst || []).map((id) => LANDING_FAQ.find((f) => f.id === id)).filter((f): f is (typeof LANDING_FAQ)[number] => !!f);
    const seen = new Set<string>();
    return [...first, ...base.filter((f) => f.id !== 'which-one')].filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  }, [intent]);

  const headerCta: ReactNode = (
    <CtaLink to={BOOK_TO} className="bk-head-cta" props={{ cta_location: 'header', product: 'guide', variant }}>
      Get the book
    </CtaLink>
  );

  return (
    <Layout chrome="book" headerCta={headerCta}>
      <Seo
        title={intent?.metaTitle || 'Before They Say No™ — Get Approved for the Home You Want | RentReady'}
        description={
          intent?.metaDescription ||
          'Bad credit, collections, or past rental problems? Learn what property managers look for, what may be hurting your approval chances, and how to prepare a stronger application before you apply.'
        }
      />

      <div className="bk" ref={root}>
        {/* 1 — HERO: "Is this what I'm looking for?" */}
        <section className="bk-hero" aria-labelledby="hero-h">
          <div className="wrap bk-hero-grid">
            <div className="bk-hero-book">
              <BookVisual size="hero" eager />
            </div>
            <div className="bk-hero-copy">
              <p className="bk-ribbon">The Rental Approval Playbook</p>
              <h1 id="hero-h" className="bk-title">Get Approved for the Home You <span>Want.</span></h1>
              <p className="bk-hero-sub">
                {intent ? intent.hero.headline.filter(Boolean).join(' ') : <>Bad credit? Collections? Past rental problems? <span>You still have options.</span></>}
              </p>
              <p className="bk-hero-body">
                Learn what property managers look for, what may be hurting your approval chances, and the steps you can take to strengthen your credit, prepare your application, and turn past denials into your next approval.
              </p>
              <p className="bk-hero-em">Know what they may see. Fix what you can. Apply better prepared.</p>
              <BuyBlock location="hero" />
              <a className="bk-hero-quiz" href="#find" onClick={() => track('primary_cta_click', { cta_location: 'hero_quiz', variant })}>
                Not sure which option fits you? Answer 3 quick questions <Arrow />
              </a>
            </div>
          </div>
          <span id="hero-end" aria-hidden="true" style={{ display: 'block' }} />
        </section>
        <TrustBar />

        {/* 2 — WHO THIS IS FOR: "Is this for someone like me?" */}
        <section className="bk-sec bk-gold bk-torn" aria-labelledby="who-h">
          <div className="wrap">
            <div className="bk-head center" data-reveal>
              <h2 id="who-h" className="bk-h2">If Getting Approved Feels Harder Than Finding the Home, This Book Is for You.</h2>
            </div>
            <div className="bk-who-intro center">
              {intent ? (
                <ul className="bk-beats bk-beats-intent">
                  {intent.recognition.map((t, i) => (
                    <li key={t} data-reveal style={delay(90 * i)}>{t}</li>
                  ))}
                </ul>
              ) : (
                <ul className="bk-beats">
                  {['You found the apartment.', 'You can afford the rent.', 'You’re ready to move.'].map((t, i) => (
                    <li key={t} data-reveal style={delay(90 * i)}>{t}</li>
                  ))}
                </ul>
              )}
              <p className="bk-who-but" data-reveal>But one question keeps running through your mind:</p>
              <p className="bk-who-q" data-reveal>“What are they going to see when they run my application?”</p>
            </div>
            <div className="bk-cards bk-cards-4">
              {PROBLEMS.map((c, i) => (
                <article key={c.title} className="bk-card bk-card-cream" data-reveal style={delay(70 * i)}>
                  <span className="bk-card-ic"><Icon name={c.icon} /></span>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </article>
              ))}
            </div>
            <p className="bk-closer center" data-reveal>You shouldn’t have to walk into the application process completely blind.</p>
          </div>
        </section>

        {/* 3 — THE CORE PROBLEM: "Do they understand what I'm dealing with?" */}
        <section className="bk-sec bk-white" aria-labelledby="core-h">
          <div className="wrap">
            <div className="bk-head center" data-reveal>
              <h2 id="core-h" className="bk-h2">Most Renters See the Home.<br /><em>Property Managers See the Application.</em></h2>
              <p className="bk-body">
                You’re picturing the bedroom, the kitchen, the neighborhood, the commute, the schools — maybe even where your furniture will go. Meanwhile, the leasing office may be evaluating something else entirely.
              </p>
            </div>
            <div className="bk-split">
              <div className="bk-split-col bk-split-you" data-reveal>
                <span className="bk-split-tag">What you’re picturing</span>
                <ul>{YOU_SEE.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
              <span className="bk-split-vs" aria-hidden="true">vs.</span>
              <div className="bk-split-col bk-split-them" data-reveal style={delay(120)}>
                <span className="bk-split-tag">What the leasing office may evaluate</span>
                <ul>{THEY_SEE.map((t) => <li key={t}><Icon name="eye" />{t}</li>)}</ul>
              </div>
            </div>
            <p className="bk-transition center" data-reveal>
              Before they review your application, you should have a better idea of what they may see.
            </p>
            <div className="bk-intro-book" data-reveal>
              <BookVisual size="mid" />
              <p>That’s why we created <strong>Before They Say No™.</strong></p>
            </div>
          </div>
        </section>

        {/* 4 — WHAT THE BOOK IS DESIGNED TO DO: "Can this actually help me?" */}
        <section className="bk-sec bk-dark" id="how" aria-labelledby="prep-h">
          <div className="wrap">
            <div className="bk-head center" data-reveal>
              <h2 id="prep-h" className="bk-h2">Don’t Just Apply. <em>Prepare.</em></h2>
              <p className="bk-body bk-on-dark">
                Before They Say No™ helps you understand the rental approval process before you put another application in someone else’s hands.
              </p>
              <Chain steps={['See', 'Identify', 'Prepare', 'Apply']} />
            </div>
            <ol className="bk-steps">
              {STEPS.map((s, i) => (
                <li key={s.n} data-reveal style={delay(90 * i)}>
                  <span className="bk-step-n">{s.n}</span>
                  <span className="bk-step-tag">{s.tag}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 4b — FINDER: "Which one is right for me?" (skippable; never gates anything) */}
        <section className="bk-sec bk-ivory" id="find" aria-labelledby="find-h">
          <div className="wrap bk-find">
            <div className="bk-head center" data-reveal>
              <span className="bk-label">30-second finder</span>
              <h2 id="find-h" className="bk-h2">Find the right RentReady option <em>for where you are.</em></h2>
              <p className="bk-body">Three questions. We’ll recommend the one that fits your timeline and tell you why — or skip straight to the special offer.</p>
            </div>
            <div data-reveal><QualifyQuiz onResult={setRec} /></div>
          </div>
        </section>

        {/* 5 — SHORT STORY: "Do they understand how this feels?" */}
        <section className="bk-sec bk-ivory bk-story" aria-labelledby="story-h">
          <div className="wrap bk-story-wrap">
            <h2 id="story-h" className="bk-h2 center" data-reveal>Imagine Finding the Perfect Place…</h2>
            <div className="bk-story-body">
              <p data-reveal>You walk through the door and immediately start picturing your life there.</p>
              <ul className="bk-story-beats">
                {['Your couch against that wall.', 'Your bed upstairs.', 'Coffee in the kitchen the next morning.'].map((t, i) => (
                  <li key={t} data-reveal style={delay(110 * i)}>{t}</li>
                ))}
              </ul>
              <p data-reveal>For a moment, it already feels like home.</p>
              <p className="bk-story-turn" data-reveal>Then the leasing agent hands you the application.</p>
              <p data-reveal>And suddenly that excitement turns into one question:</p>
              <p className="bk-story-q" data-reveal>“Am I actually going to get approved?”</p>
              <ul className="bk-story-maybe">
                {['Maybe your credit isn’t perfect.', 'Maybe there’s a collection you haven’t dealt with.', 'Maybe something happened years ago that still follows you.'].map((t, i) => (
                  <li key={t} data-reveal style={delay(90 * i)}>{t}</li>
                ))}
              </ul>
              <p data-reveal>Or maybe you’ve already paid application fees just to hear:</p>
              <p className="bk-story-no" data-reveal>“Unfortunately, your application wasn’t approved.”</p>
              <p className="bk-story-moment" data-reveal>That’s the moment this book was created for.</p>
              <p data-reveal>Not after another denial.</p>
              <p className="bk-story-before" data-reveal>Before you apply.</p>
            </div>
            <div className="bk-story-reveal" data-reveal>
              <BookVisual size="mid" />
              <BuyBlock location="story" center />
            </div>
          </div>
        </section>

        {/* 6 — LOGICAL TRANSFORMATION: "What changes after I read it?" */}
        <section className="bk-sec bk-dark" aria-labelledby="shift-h">
          <div className="wrap">
            <div className="bk-head center" data-reveal>
              <h2 id="shift-h" className="bk-h2">Go From Guessing to <em>Knowing What to Work On.</em></h2>
            </div>
            <div className="bk-ba">
              <div className="bk-ba-col bk-ba-before" data-reveal>
                <span className="bk-ba-tag">Before</span>
                <h3>Applying Blind</h3>
                <ul>{BEFORE.map((t) => <li key={t}><span aria-hidden="true">×</span>{t}</li>)}</ul>
              </div>
              <span className="bk-ba-arrow" aria-hidden="true">→</span>
              <div className="bk-ba-col bk-ba-after" data-reveal style={delay(120)}>
                <span className="bk-ba-tag">After</span>
                <h3>Applying Prepared</h3>
                <ul>{AFTER.map((t) => <li key={t}><Icon name="check" />{t}</li>)}</ul>
              </div>
            </div>
            <div data-reveal>
              <Chain steps={['Uncertainty', 'Clarity', 'Preparation', 'Confidence']} className="bk-chain-lg" />
            </div>
            <p className="bk-core center" data-reveal>
              You may not be able to control the leasing office’s final decision — <span>but you can stop walking into the process blind.</span>
            </p>
          </div>
        </section>

        {/* 6b — CREDIT INQUIRIES: applying blind can cost more than the fee */}
        <section className="bk-sec bk-white" aria-labelledby="inq-h">
          <div className="wrap">
            <div className="bk-head center" data-reveal>
              <span className="bk-label">Protect your credit</span>
              <h2 id="inq-h" className="bk-h2">Applying Blind Can Cost You More Than an <em>Application Fee.</em></h2>
              <p className="bk-body">
                Many rental applications include a credit check. Apply to several places without a plan, and those checks can start to add up.
              </p>
            </div>
            <div className="bk-inq">
              <div className="bk-inq-col bk-inq-risk" data-reveal>
                <h3>The hidden cost of applying blind</h3>
                <ul>{INQ_RISKS.map((t) => <li key={t}><Icon name="alert" />{t}</li>)}</ul>
              </div>
              <div className="bk-inq-col bk-inq-help" data-reveal style={delay(120)}>
                <h3>How knowing first protects you</h3>
                <ul>{INQ_HELPS.map((t) => <li key={t}><Icon name="shield" />{t}</li>)}</ul>
              </div>
            </div>
            <p className="bk-transition center" data-reveal>
              Knowing before you apply can help improve your approval odds — <em>and protect your credit while you search.</em>
            </p>
            <p className="bk-fine center" data-reveal>
              Whether a rental credit check is a hard or soft inquiry depends on the property and screening company. Ask before you apply.
            </p>
            <div data-reveal><BuyBlock location="inquiries" center /></div>
          </div>
        </section>

        {/* 7 — WHAT'S INSIDE: "What am I actually getting?" */}
        <section className="bk-sec bk-ivory" id="inside" aria-labelledby="inside-h">
          <div className="wrap">
            <div className="bk-head center" data-reveal>
              <h2 id="inside-h" className="bk-h2">Know Before They Know.</h2>
              <p className="bk-body">The information you wish you had before your last application.</p>
            </div>
            <div className="bk-cards bk-cards-3">
              {INSIDE.map((c, i) => (
                <article key={c.title} className="bk-card" data-reveal style={delay(70 * (i % 3))}>
                  <span className="bk-card-ic"><Icon name={c.icon} /></span>
                  <h3>{c.title}</h3>
                  <p>{c.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 7b — SPECIAL OFFER: the Complete Bundle (single card, price shown at checkout) */}
        <section className="bk-sec bk-white" id="options" aria-labelledby="opt-h">
          <div className="wrap">
            <div className="bk-head center" data-reveal>
              <span className="bk-label">Special offer</span>
              <h2 id="opt-h" className="bk-h2">Get the Complete Bundle. <em>Everything in one place.</em></h2>
              <p className="bk-body">The book that shows you what they may see, the letters to act on it, and the videos that walk you through it — together.</p>
            </div>
            <Options recommended={rec === 'checklist' ? undefined : rec} />
          </div>
        </section>

        {/* 8 — THE BIG TRANSFORMATION */}
        <section className="bk-sec bk-dark bk-past" aria-labelledby="past-h">
          <div className="wrap bk-past-grid">
            <div className="bk-past-book" data-reveal>
              <BookVisual size="feature" />
            </div>
            <div className="bk-past-copy">
              <h2 id="past-h" className="bk-h2" data-reveal>Your Past Doesn’t Have to Be <em>Your Plan.</em></h2>
              <ul className="bk-past-lines">
                {[
                  'Bad credit today doesn’t mean bad credit forever.',
                  'A past rental problem doesn’t mean you stop looking for a better home.',
                  'A previous denial doesn’t mean every answer will be no.',
                ].map((t, i) => <li key={t} data-reveal style={delay(90 * i)}>{t}</li>)}
              </ul>
              <p className="bk-body bk-on-dark" data-reveal>But applying over and over without understanding what’s happening can keep you stuck.</p>
              <p className="bk-past-em" data-reveal>Learn. Fix what you can. Prepare. Then move forward.</p>
              <div data-reveal><BuyBlock location="past" /></div>
            </div>
          </div>
        </section>

        {/* 9 — REAL URGENCY (no timers, no scarcity): "Why should I do this now?" */}
        <section className="bk-sec bk-gold bk-torn" aria-labelledby="now-h">
          <div className="wrap bk-now center">
            <h2 id="now-h" className="bk-h2" data-reveal>Don’t Wait Until After They Review Your Application.</h2>
            <p className="bk-now-body" data-reveal>Once you find the home you want, the application process can move quickly.</p>
            <p className="bk-now-body" data-reveal>The best time to understand your credit, rental history, and application isn’t after another denial.</p>
            <p className="bk-now-big" data-reveal>It’s before you apply.</p>
            <p className="bk-now-body" data-reveal>
              If you’re planning to move, apartment hunting now, or thinking about submitting another application, start preparing now.
            </p>
          </div>
        </section>

        {/* 9b — OBJECTIONS + PROMISE: "What if…?" */}
        <section className="bk-sec bk-white" id="faq" aria-labelledby="faq-h">
          <div className="wrap">
            <div className="bk-head center" data-reveal>
              <span className="bk-label">Fair questions, straight answers</span>
              <h2 id="faq-h" className="bk-h2">Before you decide.</h2>
            </div>
            <div className="bk-promise">
              {PROMISE.map((p, i) => (
                <article key={p.title} data-reveal style={delay(80 * i)}>
                  <span className="bk-card-ic"><Icon name={p.icon} /></span>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </article>
              ))}
            </div>
            <div data-reveal><BuyFaqList items={faq} /></div>
            <p className="bk-fine center" data-reveal>
              Still have a question? Email <a className="bk-link" href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a> — a person reads every message.
            </p>
          </div>
        </section>

        {/* 10 — FINAL CTA: "What do I do next?" */}
        <section className="bk-sec bk-dark bk-final bk-torn" id="get" aria-labelledby="final-h">
          <div className="wrap bk-final-grid">
            <div className="bk-final-book" data-reveal>
              <BookVisual size="feature" className="bv-xl" />
            </div>
            <div className="bk-final-copy">
              <h2 id="final-h" className="bk-h2" data-reveal>Your Next Application Shouldn’t Be <em>Another Guess.</em></h2>
              <p className="bk-final-sub" data-reveal>Know what they may see. Understand what may be holding you back. Prepare before you apply.</p>
              <div data-reveal>
                <BuyBlock location="final" label="Get Before They Say No™" />
              </div>
              <Assurance />
              <p className="bk-final-alt" data-reveal>
                Not ready to buy yet?{' '}
                <CtaLink to="/checklist" className="bk-link" props={{ cta_location: 'final_checklist', variant }}>
                  Get the free Before-You-Apply Checklist
                </CtaLink>
              </p>
              <p className="bk-sign" data-reveal>Your next home may start with knowing what to fix before you apply.</p>
            </div>
          </div>
        </section>
      </div>

      <StickyCta to={BOOK_TO} sentinelId="hero-end" label="Get the Book →" meta="Physical book · ships to you" props={{ product: 'guide', variant }} />
    </Layout>
  );
}
