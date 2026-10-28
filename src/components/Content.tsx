import { Icon } from './Icon';
import { Tag } from './ui';
import type { Rating } from '../lib/types';
import { TESTIMONIALS, SOCIAL_PROOF_ENABLED } from '../config/testimonials';

export interface ScenarioRow {
  label: string;
  value: string;
  rating?: Rating;
}

export function ScenarioCard({ title, tagline, rows, note }: { title: string; tagline?: string; rows: ScenarioRow[]; note: string }) {
  return (
    <article className="scenario">
      <header className="scenario-head">
        <h3>{title}</h3>
        {tagline && <span className="muted" style={{ fontSize: '0.9rem' }}>{tagline}</span>}
      </header>
      <dl>
        {rows.map((r) => (
          <div className="row" key={r.label}>
            <dt>{r.label}</dt>
            <dd>
              {r.value}
              {r.rating && <Tag rating={r.rating} />}
            </dd>
          </div>
        ))}
      </dl>
      <p className="scenario-note">{note}</p>
    </article>
  );
}

export function ComplianceBlock() {
  return (
    <section className="band band-rule" aria-labelledby="trust-h">
      <div className="wrap">
        <h2 id="trust-h" style={{ fontSize: 'var(--step-3)', marginBottom: 24 }}>What RentReady is, and what it isn’t</h2>
        <div className="compliance">
          <div>
            <h3>RentReady is</h3>
            <ul>
              <li>Education about credit reports and common rental screening</li>
              <li>Self-guided tools: templates, checklists and trackers you use yourself</li>
              <li>A preparation plan based on information you provide</li>
              <li>One-time purchases. No subscription.</li>
            </ul>
          </div>
          <div>
            <h3>RentReady is not</h3>
            <ul>
              <li>A guarantee of approval, score changes or removal of any item</li>
              <li>A credit repair service acting on your behalf</li>
              <li>Affiliated with any landlord, property manager or screening company</li>
              <li>A way to dispute accurate information just because it’s negative</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Renders nothing unless verified testimonials are supplied AND the feature flag is on. */
export function Testimonials() {
  const verified = TESTIMONIALS.filter((t) => t.verified && t.consentOnFile);
  if (!SOCIAL_PROOF_ENABLED || verified.length === 0) return null;
  return (
    <section className="band" aria-label="Customer stories">
      <div className="wrap">
        <div className="sides">
          {verified.map((t) => (
            <figure key={t.id} className="side side-you" style={{ margin: 0 }}>
              <blockquote style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: 'var(--step-1)' }}>{t.quote}</blockquote>
              <figcaption className="muted" style={{ marginTop: 12 }}>
                {t.name}
                {t.context ? `, ${t.context}` : ''}
              </figcaption>
              {t.disclosure && <p className="fine" style={{ marginTop: 8 }}>{t.disclosure}</p>}
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LockedNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="plan-lock">
      <Icon name="lock" />
      <div>{children}</div>
    </div>
  );
}
