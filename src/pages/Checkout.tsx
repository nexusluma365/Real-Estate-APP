import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { Alert, Checklist, Journey, Spinner, useOnce } from '../components/ui';
import { BookVisual } from '../components/BookVisual';
import { Icon } from '../components/Icon';
import { LeadForm } from '../components/LeadForm';
import { BundleImage } from '../components/Funnel';
import { dollars, PRODUCTS } from '../config/products';
import { buyFaq } from '../config/faq';
import { SITE } from '../config/site';
import { isMock, env } from '../lib/env';
import { track, trackPurchase } from '../lib/analytics';
import { emitLifecycle } from '../lib/lifecycle';
import { read, write } from '../lib/storage';
import {
  attemptKey,
  confirmPayment,
  createCustomer,
  createPaymentIntent,
  resetAttemptKey,
  verifyPaymentServerSide,
  type PaymentIntentRef,
} from '../lib/paymentService';
import { loadStripe, stripeAppearance, type StripeElement, type StripeElements, type StripeLike } from '../lib/stripe';
import type { CheckoutStatus, MockOutcome } from '../lib/types';
import { useFunnel } from '../state/FunnelContext';
import { ApiError } from '../lib/api';
import { restoreSession } from '../lib/leadService';

/**
 * Checkout for the two digital offers: the $39.99 Digital eBook and the $79.99 Complete Digital Bundle. Nothing ships,
 * so no address and no shipping charge. After the server verifies the payment the buyer lands on /welcome with their
 * downloads, and the webhook emails the package (netlify/lib/delivery.ts).
 * /checkout?product=guide|creditready preselects (old ?product=upgrade links open the Bundle); the buyer can switch.
 * eBook owners can only choose the Bundle; Bundle owners already have everything and go to /access.
 * No lead yet? Step 1 (name + email) happens right here, so nobody is bounced to another page.
 */
type Choice = 'creditready' | 'guide';
const ATTEMPT_SCOPE: Record<Choice, string> = { creditready: 'cr', guide: 'gd' };
/** Outcomes of reading the eBook. Hedged: we teach what may be reviewed; we don't promise decisions. */
const KNOW = [
  'What property managers and screening companies may look at when you apply',
  'What could be hurting your approval chances — credit, collections or rental history',
  'The questions to ask before you pay another application fee',
  'How to prepare your documents and explain anything on your record',
  'What to do after a denial, so you don’t repeat it',
];
/** Bundle-only: letters + videos unlock right after checkout, so these really can start today. */
const ACT = [
  'Pull your free credit reports and mark items you believe are inaccurate',
  'Watch the video guides on how the dispute process works',
  'Fill in your Microsoft Word dispute letters and send them yourself',
  'Get disputes moving now, before your application date',
];
const CHECKOUT_FAQ_IDS = ['subscription', 'delivery', 'refund', 'guarantee'];

export default function Checkout() {
  const { lead, owns, entitlements, refreshEntitlements } = useFunnel();
  const navigate = useNavigate();
  const { search } = useLocation();
  const ownsGuide = owns('guide');
  const requested = new URLSearchParams(search).get('product');
  const [picked, setPicked] = useState<Choice>(() => (requested === 'guide' ? 'guide' : 'creditready'));
  const [status, setStatus] = useState<CheckoutStatus>('preparing');
  // eBook owners never re-buy the eBook. Frozen once a payment is being confirmed: buying the eBook makes the buyer an
  // eBook owner, and switching the product mid-confirmation would start a new payment and leave this page.
  const confirming = status === 'verifying' || status === 'success';
  const choice: Choice = ownsGuide && !confirming ? 'creditready' : picked;
  const P = PRODUCTS[choice];
  const value = dollars(P.priceCents);
  const [message, setMessage] = useState('');
  const [mockOutcome, setMockOutcome] = useState<MockOutcome>('success');
  const [elementComplete, setElementComplete] = useState(isMock);
  const intent = useRef<PaymentIntentRef | null>(null);
  const stripe = useRef<StripeLike | null>(null);
  const elements = useRef<StripeElements | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const faq = useMemo(
    () =>
      buyFaq({ guidePrice: PRODUCTS.guide.priceLabel, bundlePrice: PRODUCTS.creditready.priceLabel, refundDays: env.moneyBackDays, supportEmail: SITE.supportEmail })
        .filter((f) => CHECKOUT_FAQ_IDS.includes(f.id)),
    [],
  );

  useOnce(() => track('checkout_view', { product: choice, order_value: value }));

  // Prepare Customer + PaymentIntent (server) for the chosen product and mount Stripe Elements (production).
  // Re-runs when the buyer switches product: each product has its own PaymentIntent and amount.
  useEffect(() => {
    if (!lead || entitlements.status === 'loading' || owns('creditready')) return;
    let cancelled = false;
    const mounted: StripeElement[] = [];
    intent.current = null;
    setStatus('preparing');
    setMessage('');
    setElementComplete(isMock);
    (async () => {
      try {
        // Returning from a redirect-based authentication (e.g. some 3DS / bank flows)
        const params = new URLSearchParams(search);
        const returnedPi = params.get('payment_intent');
        if (returnedPi && params.get('redirect_status') === 'succeeded') {
          await finalize(returnedPi);
          return;
        }
        const prepare = async (leadId: string) => {
          const cust = await createCustomer(leadId);
          return createPaymentIntent({ customerId: cust.customer_id, product: choice, idempotencyKey: attemptKey(ATTEMPT_SCOPE[choice]) });
        };
        let pi: PaymentIntentRef;
        try {
          pi = await prepare(lead.lead_id);
        } catch (e) {
          // Saved details but no valid server session (expired / cleared cookie): restore it once, then retry.
          if (!(e instanceof ApiError) || !['no_session', 'no_lead'].includes(e.code)) throw e;
          const restored = await restoreSession();
          if (!restored) throw e;
          pi = await prepare(restored.lead_id);
        }
        if (cancelled) return;
        intent.current = pi;
        if (!isMock) {
          const s = await loadStripe();
          if (cancelled || !mountRef.current) return;
          stripe.current = s;
          const els = s.elements({ clientSecret: pi.client_secret, appearance: stripeAppearance });
          elements.current = els;
          const pe = els.create('payment', { layout: 'tabs', fields: { billingDetails: { name: 'auto', email: 'never' } } });
          pe.on('change', (e) => setElementComplete(!!e.complete));
          pe.mount(mountRef.current);
          mounted.push(pe);
        }
        setStatus('ready');
        // Abandonment detection starts here: a lead who saw the payment form. Once per product per session.
        const flag = `co_started.${choice}`;
        if (!read<boolean>(flag, false, 'session')) {
          write(flag, true, 'session');
          void emitLifecycle('checkout_started', { product: choice, value });
        }
      } catch (e) {
        if (cancelled) return;
        const cfg = e instanceof ApiError && e.code === 'not_configured';
        setStatus(cfg ? 'config_error' : 'network_error');
        setMessage(e instanceof ApiError || e instanceof Error ? e.message : 'We couldn’t start checkout.');
      }
    })();
    return () => {
      cancelled = true;
      mounted.forEach((m) => m.destroy());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead, choice, entitlements.status]);

  async function finalize(paymentIntentId: string) {
    setStatus('verifying');
    // Never trust the client: the server confirms the PaymentIntent before any access is granted.
    const v = await verifyPaymentServerSide(paymentIntentId, choice);
    if (!v.verified) {
      setStatus('network_error');
      setMessage('We couldn’t confirm your payment yet. If you were charged, your access will appear shortly — check your email.');
      inFlight.current = false;
      return;
    }
    await refreshEntitlements();
    // Reported once per transaction, with the verified amount.
    trackPurchase('front', choice, v.order?.amount_cents ?? P.priceCents, v.order?.order_id);
    resetAttemptKey(ATTEMPT_SCOPE[choice]);
    setStatus('success');
    // Straight to the downloads. The package email follows from the webhook.
    navigate('/welcome', { replace: true });
  }

  async function onPay(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current || status === 'processing' || status === 'verifying' || status === 'success') return; // duplicate protection
    if (!intent.current) return;
    if (!isMock && !elementComplete) {
      setStatus('validation_error');
      setMessage('Complete your card details to continue.');
      return;
    }
    inFlight.current = true;
    setStatus('processing');
    setMessage('');
    track('checkout_started', { product: choice, order_value: value });

    const result = await confirmPayment({
      paymentIntentId: intent.current.payment_intent_id,
      mockOutcome,
      confirmWithStripe:
        stripe.current && elements.current
          ? () =>
              stripe.current!.confirmPayment({
                elements: elements.current!,
                redirect: 'if_required',
                confirmParams: { return_url: `${env.siteUrl}/checkout?product=${choice}` },
              })
          : undefined,
    });

    if (result.status === 'succeeded') {
      try {
        await finalize(result.payment_intent_id);
      } catch {
        setStatus('network_error');
        setMessage('Your payment went through, but we couldn’t load your access. Reload this page — you won’t be charged again.');
        inFlight.current = false;
      }
      return;
    }
    inFlight.current = false;
    setStatus(result.status);
    setMessage(result.message);
    track('credit_purchase_failed', { product: choice, reason: result.status });
    // In production Stripe's payment_intent.payment_failed webhook emits this; the mock mirrors it.
    if (isMock && result.status === 'declined') void emitLifecycle('payment_failed', { product: choice });
  }

  if (entitlements.status === 'loaded' && status !== 'success' && status !== 'verifying') {
    if (owns('creditready')) return <Navigate to="/access" replace />;
    if (requested === 'guide' && ownsGuide) return <Navigate to="/access" replace />;
  }

  const busy = status === 'processing' || status === 'verifying' || status === 'success';
  const ready = status !== 'preparing' && status !== 'config_error';

  function choose(c: Choice) {
    if (c === choice || busy) return;
    setPicked(c);
    track('primary_cta_click', { cta_location: 'checkout_product', variant: c });
  }

  return (
    <Layout chrome="focused">
      <Seo title={`Checkout — ${P.name} | RentReady`} noindex />
      <div className="checkout">
        <aside className="checkout-summary" aria-labelledby="sum-h">
          <div className="checkout-inner stack" style={{ ['--s' as string]: '24px' }}>
            <Journey at={3} />
            <h1 id="sum-h" className="co-title" style={{ fontSize: 'var(--step-4)' }}>{P.name}</h1>
            <p className="muted co-title-sub">{P.promise}</p>
            {/* The eBook shows the book cover; the Bundle shows the full bundle. */}
            {choice === 'guide' ? (
              <div className="co-img co-img-book"><BookVisual size="mid" eager /></div>
            ) : (
              <div className="co-img"><BundleImage sizes="(min-width: 900px) 440px, 92vw" eager /></div>
            )}
            <Checklist items={P.includes} />

            {/* Transformation, not price: what they'll know (the book) + what they can start today (the Bundle). */}
            <div className="co-outcome" aria-labelledby="know-h">
              <h2 id="know-h">After reading, you’ll know</h2>
              <ul>{KNOW.map((t) => <li key={t}><Icon name="check" />{t}</li>)}</ul>
            </div>
            {choice !== 'guide' && (
              <div className="co-outcome co-outcome-act" aria-labelledby="act-h">
                <h2 id="act-h">What you can start doing today</h2>
                <ul>{ACT.map((t) => <li key={t}><Icon name="check" />{t}</li>)}</ul>
              </div>
            )}
            <p className="fine">One-time payment. No recurring subscription. 100% digital — no shipping, no waiting.</p>

            <div className="co-next" aria-labelledby="next-h">
              <h2 id="next-h">What happens after you order</h2>
              <ol>
                <li><strong>Instantly</strong> — your downloads open: the eBook{choice === 'guide' ? '' : ', your dispute letters and your video guides'}.</li>
                <li><strong>Within minutes</strong> — “Your RentReady Digital Package Is Ready!” arrives by email, with your order details and a button back to everything you bought.</li>
                <li><strong>Anytime later</strong> — sign in with your email on the access page for a fresh link. Your access doesn’t expire.</li>
              </ol>
            </div>

          </div>
        </aside>

        <section className="checkout-pay" aria-labelledby="pay-h">
          {!lead ? (
            <div className="checkout-inner">
              <span className="co-step">Step 1 of 2</span>
              <h2 id="pay-h" style={{ fontSize: 'var(--step-3)' }}>Where should we send your access?</h2>
              <p className="muted" style={{ margin: '10px 0 24px' }}>Your receipt and access link go here, so you can open your purchase on any device.</p>
              <LeadForm source="checkout" productInterest={choice} submitLabel="Continue to payment" onDone={() => track('primary_cta_click', { cta_location: 'checkout_details', product: choice })} />
              <CheckoutAssurance />
            </div>
          ) : (
            <form className="checkout-inner form" onSubmit={onPay} noValidate>
              <span className="co-step">Step 2 of 2</span>
              <h2 id="pay-h" style={{ fontSize: 'var(--step-3)' }}>Complete your order</h2>

              <div className="who-box">
                <span>
                  {lead.first_name && <><strong>{lead.first_name}</strong><br /></>}
                  <span className="muted">{lead.email}</span>
                </span>
                <Link to={`/start?next=${encodeURIComponent(`/checkout?product=${choice}`)}`} className="text-link" style={{ fontSize: '0.9rem' }}>Change</Link>
              </div>

              {ownsGuide ? (
                <Alert kind="ok">You already own the eBook. The Complete Digital Bundle adds the 20 editable dispute letters and the video guides.</Alert>
              ) : (
                <fieldset className="format-pick" disabled={busy}>
                  <legend>Choose your digital package</legend>
                  <label className={choice === 'creditready' ? 'on' : ''}>
                    <input type="radio" name="product" checked={choice === 'creditready'} onChange={() => choose('creditready')} />
                    <span><strong>Complete Digital Bundle <em className="format-tag">eBook + tools</em></strong><small>eBook + 20 dispute letters + video guides</small></span>
                    <b>{PRODUCTS.creditready.priceLabel}</b>
                  </label>
                  <label className={choice === 'guide' ? 'on' : ''}>
                    <input type="radio" name="product" checked={choice === 'guide'} onChange={() => choose('guide')} />
                    <span><strong>Digital eBook</strong><small>Know Before They Say NO! (PDF)</small></span>
                    <b>{PRODUCTS.guide.priceLabel}</b>
                  </label>
                </fieldset>
              )}
              <p className="fine" style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
                <Icon name="download" width={16} height={16} />Instant digital access after payment. No shipping, no shipping fees.
              </p>

              <div className="field">
                <span style={{ fontWeight: 600 }}>Payment</span>
                <div className="pay-box" aria-busy={status === 'preparing'}>
                  {status === 'preparing' && (
                    <div className="loader" style={{ minHeight: 110 }}><span className="dot" /> <span>Preparing secure payment…</span></div>
                  )}
                  {status === 'config_error' && (
                    <Alert kind="error">
                      Checkout is temporarily unavailable. {message}
                    </Alert>
                  )}
                  {/* Production: Stripe Payment Element mounts here. Card data never enters this app. */}
                  <div ref={mountRef} hidden={isMock || status === 'preparing'} />
                  {isMock && ready && (
                    <div className="pay-placeholder">
                      <div className="ph"><Icon name="card" width={18} height={18} style={{ marginRight: 10 }} />Stripe Payment Element renders here</div>
                      <fieldset className="dev-sim">
                        <legend>Development payment simulator</legend>
                        <span className="fine">No card fields in mock mode. Choose an outcome to test:</span>
                        <div className="opts" role="radiogroup">
                          {(['success', 'decline', 'network_error'] as MockOutcome[]).map((o) => (
                            <label key={o}>
                              <input type="radio" name="mock" checked={mockOutcome === o} onChange={() => setMockOutcome(o)} />
                              {o === 'success' ? 'Approve' : o === 'decline' ? 'Card declined' : 'Network error'}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    </div>
                  )}
                </div>
              </div>

              {(status === 'declined' || status === 'validation_error' || status === 'network_error') && message && (
                <Alert kind="error">
                  {message}
                  {status === 'declined' && <> You have not been charged. Try another card, or email <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a> and we’ll help.</>}
                </Alert>
              )}

              <button className="btn btn-block" type="submit" disabled={!ready || busy} aria-busy={busy}>
                {status === 'processing' ? <><Spinner /> Processing payment</> : status === 'verifying' || status === 'success' ? <><Spinner /> Confirming your order</> : `Get Instant Digital Access — ${P.priceLabel}`}
              </button>
              <CheckoutAssurance />

              <div className="fine" style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 10 }}>
                <Icon name="lock" width={16} height={16} />
                <span>
                  Payments are processed by Stripe. RentReady never sees or stores your full card number. Questions?{' '}
                  <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
                </span>
              </div>
            </form>
          )}

          <div className="checkout-inner co-faq">
            <h2>Quick answers</h2>
            <div className="faq">
              {faq.map((f) => (
                <details key={f.id} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && track('faq_open', { step: f.id, cta_location: 'checkout' })}>
                  <summary>{f.q}</summary>
                  <div className="answer"><p>{f.a}</p></div>
                </details>
              ))}
            </div>
            <p className="fine" style={{ marginTop: 18 }}>
              RentReady is an educational resource and does not guarantee apartment approval, credit score changes, or
              removal of any information.
              {(SITE.termsUrl || SITE.privacyUrl) && (
                <>
                  {' '}
                  {SITE.termsUrl && <a href={SITE.termsUrl}>Terms</a>}
                  {SITE.termsUrl && SITE.privacyUrl && ' · '}
                  {SITE.privacyUrl && <a href={SITE.privacyUrl}>Privacy</a>}
                </>
              )}
            </p>
          </div>
        </section>
      </div>
    </Layout>
  );
}

function CheckoutAssurance() {
  return (
    <ul className="co-assure">
      <li><Icon name="lock" />Secure checkout by Stripe</li>
      <li><Icon name="card" />One-time payment</li>
      {env.moneyBackDays > 0 && <li><Icon name="shield" />{env.moneyBackDays}-day money-back guarantee</li>}
    </ul>
  );
}
