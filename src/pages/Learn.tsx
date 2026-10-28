import { useState } from 'react';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { CtaLink, Journey, StickyCta, useOnce } from '../components/ui';
import { ApplicationSheet, ScreeningSheet } from '../components/Visuals';
import { ScenarioCard } from '../components/Content';
import { Icon } from '../components/Icon';
import { track } from '../lib/analytics';
import { useFunnel } from '../state/FunnelContext';

const FACTORS = [
  { t: 'Credit', b: 'A credit report or score may be pulled. Some properties look at specific items — like collections tied to prior rentals or utilities.' },
  { t: 'Income', b: 'Often written as a multiple of rent, such as 2.5× or 3×. Some properties combine co-applicants; some don’t.' },
  { t: 'Rental history', b: 'Prior landlords may be contacted. Late payments, balances owed or lease breaks can come up.' },
  { t: 'Tenant screening', b: 'Some properties use a screening company that compiles credit, eviction and other records into one report.' },
  { t: 'Documentation', b: 'Pay stubs, offer letters, tax returns or bank statements. Inconsistent numbers can slow things down.' },
  { t: 'Property-specific rules', b: 'Every property sets its own criteria. Ask for them in writing before you pay a fee.' },
];

const CTA = 'Show me how to prepare';

export default function Learn() {
  const { firstName } = useFunnel();
  const [side, setSide] = useState<'you' | 'them'>('you');
  useOnce(() => track('consideration_view'));
  const done = { event: 'consideration_complete' as const };

  return (
    <Layout>
      <Seo title="How rental applications are reviewed | RentReady" description="Most renters only see the application. Understand what may happen after you hit Submit." />

      <section className="band" style={{ paddingTop: 48 }}>
        <div className="wrap grid-2">
          <div className="stack">
            <Journey at={1} />
            {firstName && <p className="kicker">Good to meet you, {firstName}. Here’s step one.</p>}
            <h1 style={{ fontSize: 'var(--step-5)' }}>Most renters only see the application.</h1>
            <p className="lede">RentReady helps you understand what may happen after you hit Submit.</p>
          </div>
          <div>
            <div className={`flip${side === 'them' ? ' is-flipped' : ''}`}>
              <div className="flip-inner">
                <ApplicationSheet values={{ rent: '$2,100', income: '$7,000', credit: '620–639', history: 'Positive' }} />
                <ScreeningSheet
                  rows={[
                    { label: 'Income requirement', note: 'Often 2.5–3× rent' },
                    { label: 'Credit / screening report', note: 'Pulled & reviewed' },
                    { label: 'Collections', note: 'May be considered' },
                    { label: 'Landlord reference', note: 'May be contacted' },
                    { label: 'Documents', note: 'Verified' },
                  ]}
                />
              </div>
            </div>
            <div className="flip-toggle" role="group" aria-label="Choose a side of the application">
              <button type="button" aria-pressed={side === 'you'} onClick={() => setSide('you')}>Your side</button>
              <button type="button" aria-pressed={side === 'them'} onClick={() => setSide('them')}>The property’s side</button>
            </div>
          </div>
        </div>
        <span id="learn-hero-end" />
      </section>

      <section className="band band-paper band-rule" aria-labelledby="sides-h">
        <div className="wrap">
          <h2 id="sides-h" className="measure">Every application has two sides.</h2>
          <p className="lede muted" style={{ marginTop: 14 }}>You control one of them. Understanding the other is how you stop guessing.</p>
          <div className="sides">
            <div className="side side-you">
              <span className="kicker">Side one</span>
              <h3>Your financial and rental profile</h3>
              <ul>
                {['Your credit reports and score', 'Your income and how you can document it', 'Your rental history and references', 'Anything you may need to explain'].map((t) => (
                  <li key={t}><Icon name="check" /><span>{t}</span></li>
                ))}
              </ul>
            </div>
            <div className="side-desk" aria-hidden="true">the desk</div>
            <div className="side side-them">
              <span className="kicker">Side two</span>
              <h3>The property’s screening requirements</h3>
              <ul>
                {['Its written screening criteria', 'Its income requirement', 'The screening company it uses', 'How it weighs credit, history and deposits'].map((t) => (
                  <li key={t}><Icon name="check" /><span>{t}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="fac-h">
        <div className="wrap">
          <h2 id="fac-h" className="measure">What may be reviewed.</h2>
          <p className="lede muted" style={{ marginTop: 14 }}>Not every property looks at every item. These are the ones that commonly come up.</p>
          <div className="factor-grid">
            {FACTORS.map((f) => (
              <article className="factor" key={f.t}>
                <h3>{f.t}</h3>
                <p>{f.b}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="band band-paper band-rule" aria-labelledby="sc-h">
        <div className="wrap grid-2">
          <ScenarioCard
            title="Sample application"
            tagline="Hypothetical"
            rows={[
              { label: 'Target rent', value: '$2,100' },
              { label: 'Monthly gross income', value: '$7,000', rating: 'strong' },
              { label: 'Credit range', value: '620–639', rating: 'review' },
              { label: 'Rental history', value: 'Positive', rating: 'strong' },
              { label: 'Collections', value: 'Reported', rating: 'review' },
            ]}
            note="Income may not be the only area worth reviewing. Credit and collection information could still matter depending on the property’s criteria."
          />
          <div className="stack">
            <h2 id="sc-h">Good income. Still worth a closer look.</h2>
            <p className="lede">This renter earns about 3.3× the rent. On income alone, that meets many published requirements.</p>
            <p className="muted measure">
              But a 620–639 range sits close to the minimums some properties publish, and a collection may be reviewed
              — especially if it’s tied to a prior apartment or utility. If any of it is inaccurate, that’s worth
              knowing well before applying. If it’s accurate, it’s worth being ready to discuss.
            </p>
          </div>
        </div>
      </section>

      <section className="band band-ink" aria-labelledby="next-h">
        <div className="wrap grid-2">
          <div className="stack">
            <h2 id="next-h">Start with the part you can work on.</h2>
            <p className="lede muted">
              You can’t change a property’s criteria. You can understand your credit, review what’s reported, and walk
              in prepared.
            </p>
          </div>
          <div className="stack">
            <CtaLink to="/creditready" event={done.event} props={{ cta_location: 'learn_end' }}>{CTA}</CtaLink>
            <p className="fine">Next: see what’s inside the RentReady Digital Bundle.</p>
          </div>
        </div>
      </section>

      <StickyCta to="/creditready" label={CTA} sentinelId="learn-hero-end" event="consideration_complete" />
    </Layout>
  );
}
