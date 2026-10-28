import { read, write } from './storage';
import { intentTier, recommend, type QualAnswers } from '../config/qualification';

/** Qualification answers live with the visitor and travel with the lead when they opt in. */
export const getQualification = (): QualAnswers => read<QualAnswers>('qualification', {});
export const saveQualification = (a: QualAnswers) => write('qualification', a);

export function qualificationSummary() {
  const a = getQualification();
  if (!a.stage && !a.concern && !a.help) return undefined;
  return { ...a, intent_tier: intentTier(a), recommended: recommend(a).primary };
}
