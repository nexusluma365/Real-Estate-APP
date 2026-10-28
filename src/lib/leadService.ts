import { api, wait } from './api';
import { getAttribution } from './attribution';
import { isMock } from './env';
import { getSessionId } from './session';
import { read, uid, write } from './storage';
import type { Lead } from './types';
import { sanitizeText } from './validation';
import { qualificationSummary } from './qualification';

export interface LeadInput {
  firstName: string;
  email: string;
  emailConsent: boolean;
  /** 'checkbox' = explicit opt-in; 'notice' = disclosed at the form with unsubscribe in every email. */
  consentBasis: 'checkbox' | 'notice';
  consentText: string;
  /** Where the lead opted in: start | checkout | checklist | exit */
  source: string;
  productInterest?: string;
  turnstileToken?: string;
}

export const getLead = (): Lead | null => read<Lead | null>('lead', null);

/**
 * PRODUCTION INTEGRATION — Lead capture.
 * POST /api/leads → existing RentReady lead handler (CRM/ESP + DB).
 * Server must: validate, rate-limit, verify Turnstile, upsert by email, return lead_id,
 * and set an HttpOnly session cookie used by checkout.
 */
export async function captureLead(input: LeadInput): Promise<Lead> {
  const base = {
    first_name: sanitizeText(input.firstName, 40),
    email: input.email.trim().toLowerCase(),
    email_consent: input.emailConsent,
    consent_basis: input.consentBasis,
    consent_text: input.consentText,
    lead_source: input.source,
    product_interest: input.productInterest,
    qualification: qualificationSummary(),
    session_id: getSessionId(),
    timestamp: new Date().toISOString(),
    attribution: getAttribution(),
  };

  // Progressive profiling: the same email returns the same lead (server upserts by email).
  const existing = getLead();
  let lead: Lead;
  if (isMock) {
    await wait(650);
    const lead_id = existing?.email === base.email ? existing.lead_id : uid('mock_lead');
    lead = { ...base, lead_id, mock: true };
  } else {
    const res = await api<{ lead_id: string }>('/leads', {
      json: { ...base, turnstile_token: input.turnstileToken },
    });
    lead = { ...base, lead_id: res.lead_id };
  }
  write('lead', lead);
  return lead;
}
