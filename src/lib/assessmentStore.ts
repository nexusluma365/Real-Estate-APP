import type { Answers } from '../config/assessment';
import { api } from './api';
import { isMock } from './env';
import { read, remove, write } from './storage';

/**
 * Assessment answers are personal financial context. They are kept on this device
 * in mock mode and, in production, saved to the customer record over an authenticated call.
 * They are NEVER sent to analytics.
 */
export interface AssessmentState {
  answers: Answers;
  index: number;
  completedAt?: string;
}

export const loadAssessment = (): AssessmentState => read<AssessmentState>('assessment', { answers: {}, index: 0 });

export function saveAssessment(s: AssessmentState) {
  write('assessment', s);
  if (!isMock) {
    // PRODUCTION INTEGRATION: PUT /api/assessment (authenticated). Fire-and-forget.
    api('/assessment', { method: 'PUT', json: s }).catch(() => undefined);
  }
}

export const resetAssessment = () => remove('assessment');
