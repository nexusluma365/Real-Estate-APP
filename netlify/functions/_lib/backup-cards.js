// Backup-card fallback for the listing membership renewal.
//
// When a $19.99 renewal invoice fails on the subscription's main card, try
// the SAME invoice once with each backup card the customer saved during a
// customer-initiated upsell (see fulfillment.js / charge-upsell.js).
//
//   - Only backup cards attached to this lead's own Stripe customer.
//   - Never the card that just failed, nor another copy of it (same
//     fingerprint).
//   - Each card is tried at most once per invoice (idempotency key per
//     invoice + card), so Stripe redelivering invoice.payment_failed — or the
//     new failure event our own attempt causes — can't charge-loop.
//   - The subscription's main card is not changed; Stripe's own retries keep
//     using it. If a backup pays, Stripe sends invoice.paid and the normal
//     sync restores access.
const { idOf } = require('./fulfillment');
const { paymentErrorLogFields } = require('./payment-errors');

const store = () => require('./store');
const logFunnelEvent = (event, fields) => require('./funnel').logFunnelEvent(event, fields);

async function fingerprintOf(stripe, paymentMethodId) {
  if (!paymentMethodId) return null;
  const pm = await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null);
  return (pm && pm.card && pm.card.fingerprint) || null;
}

async function retryInvoiceWithBackupCards(stripe, invoice, subscription) {
  const leadId = subscription && subscription.metadata && subscription.metadata.leadId;
  if (!leadId || !invoice || !invoice.id) return { attempted: false, reason: 'no_lead' };
  if (invoice.status && invoice.status !== 'open') return { attempted: false, reason: `invoice_${invoice.status}` };
  if (!(invoice.amount_due > 0)) return { attempted: false, reason: 'nothing_due' };

  const entitlements = await store().getEntitlements(leadId);
  const backups = Array.isArray(entitlements.backupPaymentMethodIds) ? entitlements.backupPaymentMethodIds : [];
  const customer = idOf(invoice.customer);
  if (!backups.length) return { attempted: false, reason: 'no_backup_cards' };
  if (!customer || customer !== entitlements.stripeCustomerId) return { attempted: false, reason: 'customer_mismatch' };

  // The card that just failed on this invoice.
  let failedCard = null;
  const invoicePi = idOf(invoice.payment_intent);
  if (invoicePi) {
    const pi = await stripe.paymentIntents.retrieve(invoicePi).catch(() => null);
    failedCard = pi && (idOf(pi.last_payment_error && pi.last_payment_error.payment_method) || idOf(pi.payment_method));
  }
  failedCard = failedCard || idOf(subscription.default_payment_method) || entitlements.defaultPaymentMethodId;
  const failedFingerprint = await fingerprintOf(stripe, failedCard);

  for (const card of backups) {
    if (card === failedCard) continue;
    const method = await stripe.paymentMethods.retrieve(card).catch(() => null);
    if (!method || idOf(method.customer) !== customer) continue; // detached or not theirs
    if (failedFingerprint && method.card && method.card.fingerprint === failedFingerprint) continue;
    try {
      const paid = await stripe.invoices.pay(
        invoice.id,
        { payment_method: card, off_session: true },
        { idempotencyKey: `rr-invoice-backup:${invoice.id}:${card}` }
      );
      if (paid && paid.status === 'paid') {
        console.warn('renewal paid with backup card', { leadId, invoiceId: invoice.id, funding: method.card && method.card.funding });
        await logFunnelEvent('subscription_paid_backup_card', { lead_id: leadId, payment_id: invoice.id, amount: (invoice.amount_due || 0) / 100 });
        return { attempted: true, paid: true, paymentMethod: card };
      }
    } catch (err) {
      // A decline, an already-tried card (cached by its idempotency key), or
      // an invoice that just got paid another way: move on, never re-charge.
      console.warn('backup card renewal attempt failed', { leadId, invoiceId: invoice.id, ...paymentErrorLogFields(err) });
    }
  }
  return { attempted: true, paid: false };
}

module.exports = { retryInvoiceWithBackupCards };
