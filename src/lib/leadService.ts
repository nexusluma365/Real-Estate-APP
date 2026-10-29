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
  // An email-only form (the free-book popup) keeps the name we already have for that email.
  if (!base.first_name && existing?.email === base.email) base.first_name = existing.first_name;
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

/**
 * The browser remembers the lead, but the server's session cookie can be gone (expired, cleared, or signed with an
 * older secret). Re-submitting the saved email upserts the same lead and issues a fresh cookie — no re-typing.
 * Consent is never raised here: the server keeps whichever consent was already recorded.
 */
export async function restoreSession(): Promise<Lead | null> {
  const saved = getLead();
  if (!saved?.email) return null;
  return captureLead({
    firstName: saved.first_name || '',
    email: saved.email,
    emailConsent: false,
    consentBasis: 'notice',
    consentText: 'Session restored at checkout from details the visitor entered earlier.',
    // An email-only lead (free-book popup) has no name; the server accepts that only for the 'exit' source.
    source: saved.first_name ? 'checkout' : 'exit',
  });
}

