/**
 * Buyer qualification: three short, skippable questions that recommend the right option.
 *
 * Intent tier is a COMMERCIAL-urgency signal only (timeline + kind of help wanted + engagement).
 * It never uses credit scores, income, or any personal circumstance as a measure of a person's worth,
 * and it is never sent to ad platforms. Every tier gets a genuinely useful next step.
 */
export type Stage = 'soon7' | 'soon30' | 'denied' | 'research';
export type Concern = 'credit' | 'history' | 'requirements' | 'unknown';
export type Help = 'system' | 'read' | 'why' | 'free';
export type IntentTier = 'high' | 'medium' | 'early';
export type Recommendation = 'creditready' | 'guide' | 'checklist';

export interface QualAnswers {
  stage?: Stage;
  concern?: Concern;
  help?: Help;
}

export const QUAL_QUESTIONS = [
  {
    id: 'stage' as const,
    q: 'Where are you in your apartment search?',
    options: [
      { v: 'soon7', label: 'Applying within 7 days' },
      { v: 'soon30', label: 'Applying within 30 days' },
      { v: 'denied', label: 'I was already denied' },
      { v: 'research', label: 'Researching for the future' },
    ],
  },
  {
    id: 'concern' as const,
    q: 'What concerns you most?',
    options: [
      { v: 'credit', label: 'Credit or collections' },
      { v: 'history', label: 'Rental history' },
      { v: 'requirements', label: 'Application requirements' },
      { v: 'unknown', label: 'Not knowing what they check' },
    ],
  },
  {
    id: 'help' as const,
    q: 'What kind of help do you want?',
    options: [
      { v: 'system', label: 'Letters + videos to dispute items' },
      { v: 'read', label: 'A book that explains the process' },
      { v: 'why', label: 'Understand why applications get denied' },
      { v: 'free', label: 'Free information before I decide' },
    ],
  },
];

const STAGE_SCORE: Record<Stage, number> = { soon7: 3, denied: 3, soon30: 2, research: 0 };
const HELP_SCORE: Record<Help, number> = { system: 3, read: 2, why: 2, free: 0 };

export function intentTier(a: QualAnswers): IntentTier {
  const s = (a.stage ? STAGE_SCORE[a.stage] : 0) + (a.help ? HELP_SCORE[a.help] : 0);
  return s >= 4 ? 'high' : s >= 2 ? 'medium' : 'early';
}

export function recommend(a: QualAnswers): { primary: Recommendation; secondary: Recommendation } {
  if (a.help === 'free') return { primary: 'checklist', secondary: 'guide' };
  if (a.help === 'system') return { primary: 'creditready', secondary: 'guide' };
  if (a.help === 'read') return { primary: 'guide', secondary: 'creditready' };
  // "Why do applications get denied?" — the book answers it; credit work and past denials need the tools.
  if (a.stage !== 'research' && (a.concern === 'credit' || a.stage === 'denied')) return { primary: 'creditready', secondary: 'guide' };
  return { primary: 'guide', secondary: 'creditready' };
}

const STAGE_LINE: Record<Stage, string> = {
  soon7: 'With about a week before you apply, the goal is knowing what’s on your reports, asking the right questions before you pay a fee, and having your documents and explanations ready. Disputes usually take longer than a week, so start them now and be ready to explain anything still open.',
  soon30: 'A month is real preparation time — enough to review your reports, start disputes on anything inaccurate, and organize your application.',
  denied: 'After a denial, the most useful first step is finding out exactly what was reported, and fixing what you can before you pay another fee.',
  research: 'Starting early is the best position to be in. You’ll have time to review, correct and organize before it matters.',
};
const CONCERN_LINE: Record<Concern, string> = {
  credit: 'Because credit or collections is your main concern, the dispute letter templates and the video guide are where most of your work will happen.',
  history: 'Because rental history is your main concern, you’ll want to understand how prior leases and balances come up — and how to prepare to address them.',
  requirements: 'Because requirements are your main concern, you’ll learn how screening criteria are written and how to read them before you apply.',
  unknown: 'Because you’re not sure what they check, you’ll start by seeing an application from the property’s side.',
};

export function explain(a: QualAnswers): string {
  return [a.stage && STAGE_LINE[a.stage], a.concern && CONCERN_LINE[a.concern]].filter(Boolean).join(' ');
}
