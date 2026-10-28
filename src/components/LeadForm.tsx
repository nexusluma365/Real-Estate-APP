import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Spinner } from './ui';
import { Icon } from './Icon';
import { captureLead } from '../lib/leadService';
import { resetAttemptKey } from '../lib/paymentService';
import { reportAdsConversion, track } from '../lib/analytics';
import { emitLifecycle } from '../lib/lifecycle';
import { env } from '../lib/env';
import { ApiError } from '../lib/api';
import { validateEmail, validateFirstName } from '../lib/validation';
import { useFunnel } from '../state/FunnelContext';
import type { Lead, ProductId } from '../lib/types';

/**
 * One lead form for every opt-in point (start, checkout, free checklist).
 * Transactional email (receipts, access) is always sent. Marketing email is either explicit opt-in
 * (VITE_REQUIRE_EMAIL_CONSENT=true, or `optIn` for free resources) or clearly disclosed with unsubscribe.
 */
export function LeadForm({
  source,
  submitLabel,
  productInterest,
  optIn = env.requireEmailConsent,
  optInLabel = 'Email me my RentReady access and helpful reminders. Unsubscribe anytime.',
  helpText = 'We’ll send your access here.',
  footnote,
  requireFirstName = true,
  emailConsentValue,
  consentText,
  finePrint,
  onDone,
}: {
  source: 'start' | 'checkout' | 'checklist' | 'exit';
  submitLabel: string;
  productInterest?: ProductId;
  optIn?: boolean;
  optInLabel?: string;
  helpText?: string;
  footnote?: ReactNode;
  requireFirstName?: boolean;
  emailConsentValue?: boolean;
  consentText?: string;
  finePrint?: string;
  onDone: (lead: Lead) => void;
}) {
  const { lead, setLead } = useFunnel();
  const [firstName, setFirstName] = useState(lead?.first_name || '');
  const [email, setEmail] = useState(lead?.email || '');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<{ firstName?: string; email?: string }>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const id = `lf-${source}`;

  const onStart = () => {
    if (!started.current) {
      started.current = true;
      track('lead_started', { cta_location: source });
    }
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const errs = { firstName: requireFirstName ? validateFirstName(firstName) || undefined : undefined, email: validateEmail(email) || undefined };
    setErrors(errs);
    setFormError('');
    if (errs.firstName) return nameRef.current?.focus();
    if (errs.email) return emailRef.current?.focus();
    setBusy(true);
    try {
      const l = await captureLead({
        firstName,
        email,
        emailConsent: emailConsentValue ?? (optIn ? consent : true),
        consentBasis: optIn ? 'checkbox' : 'notice',
        consentText: optIn ? optInLabel : consentText || 'Disclosed at sign-up: access email plus occasional RentReady updates, unsubscribe anytime.',
        source,
        productInterest,
      });
      setLead(l);
      resetAttemptKey('cr');
      resetAttemptKey('gd');
      track('lead_captured', { cta_location: source, product: productInterest, intent_tier: l.qualification?.intent_tier });
      reportAdsConversion('lead');
      void emitLifecycle('lead_captured', { source, product: productInterest });
      onDone(l);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Something went wrong saving your details. Try again.');
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      {formError && <Alert kind="error">{formError}</Alert>}
      {requireFirstName && (
        <div className="field">
          <label htmlFor={`${id}-fn`}>First name</label>
          <input
            ref={nameRef}
            id={`${id}-fn`}
            className="input"
            autoComplete="given-name"
            value={firstName}
            maxLength={40}
            onFocus={onStart}
            onChange={(e) => setFirstName(e.target.value)}
            aria-invalid={!!errors.firstName}
            aria-describedby={errors.firstName ? `${id}-fn-err` : undefined}
          />
          {errors.firstName && <span id={`${id}-fn-err`} className="field-error"><Icon name="alert" width={16} height={16} />{errors.firstName}</span>}
        </div>
      )}
      <div className="field">
        <label htmlFor={`${id}-em`}>Email</label>
        <input
          ref={emailRef}
          id={`${id}-em`}
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          maxLength={254}
          onFocus={onStart}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? `${id}-em-err` : `${id}-em-help`}
        />
        {errors.email ? (
          <span id={`${id}-em-err`} className="field-error"><Icon name="alert" width={16} height={16} />{errors.email}</span>
        ) : (
          <span id={`${id}-em-help`} className="field-help">{helpText}</span>
        )}
      </div>

      {optIn && (
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{optInLabel}</span>
        </label>
      )}

      {/* PRODUCTION INTEGRATION: render Cloudflare Turnstile here when VITE_TURNSTILE_SITE_KEY is set, pass token to captureLead */}

      <button className="btn btn-block" type="submit" disabled={busy} aria-busy={busy}>
        {busy ? <><Spinner /> Saving</> : submitLabel}
      </button>
      <p className="fine">
        {finePrint || `No credit pull. ${optIn ? 'We never sell your email.' : 'We’ll email your access and occasional RentReady updates — unsubscribe anytime. We never sell your email.'}`}
        {footnote && <> {footnote}</>}
      </p>
    </form>
  );
}
