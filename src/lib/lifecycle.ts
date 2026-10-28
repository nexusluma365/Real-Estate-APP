import { api } from './api';
import { isMock } from './env';
import { read, write } from './storage';

/**
 * Lifecycle hooks for email flows. The CLIENT only reports facts; the server records them and
 * forwards them to the ESP, which owns timing, suppression and unsubscribe. Nothing is emailed from here.
 *
 * Purchases, payment failures, refunds and abandoned checkouts are emitted by the SERVER
 * (Stripe webhook + /api/cron/abandoned) — never trusted from the browser.
 */
export type LifecycleEvent =
  | 'lead_captured'
  | 'qualification_completed'
  | 'free_resource_requested'
  | 'checkout_started'
  | 'payment_failed'
  | 'upsell_declined'
  | 'upsell_failed'
  | 'assessment_started'
  | 'assessment_incomplete'
  | 'assessment_complete'
  | 'product_accessed'
  | 'gameplan_completed'
  // server-only (listed so the mock outbox can show the whole journey)
  | 'purchase_completed'
  | 'checkout_abandoned'
  | 'refund_processed'
  | 'access_link_requested';

/**
 * Planned flows. Copy for every message is in EMAIL_SEQUENCES.md. Each flow's exit condition is
 * enforced by the ESP (and by /api/cron/abandoned, which never flags a lead that has purchased).
 */
export const EMAIL_FLOWS: { id: string; trigger: LifecycleEvent; delay: string; subject: string; goal: string; exit?: string }[] = [
  // Post-purchase (transactional first, then helpful)
  { id: 'order_confirmation', trigger: 'purchase_completed', delay: 'immediate', subject: 'Your RentReady order is confirmed — here’s your access', goal: 'Deliver access link + what happens next' },
  { id: 'start_reading', trigger: 'purchase_completed', delay: '1 day', subject: 'Start here: the 20-minute first step', goal: 'Open the product', exit: 'product_accessed' },
  { id: 'assessment_nudge', trigger: 'purchase_completed', delay: '4 days', subject: 'Your game plan takes about five minutes', goal: 'Complete the assessment (Digital Bundle owners)', exit: 'assessment_complete' },
  { id: 'before_you_apply', trigger: 'gameplan_completed', delay: '2 days', subject: 'Before you apply, ask these questions', goal: 'Use the plan' },
  { id: 'upgrade_offer', trigger: 'purchase_completed', delay: '10 days', subject: 'Add the dispute letters and video guide for $32', goal: 'Book-only owners — single, soft upgrade note' },
  { id: 'upsell_decline_followup', trigger: 'upsell_declined', delay: '5 days', subject: 'See your application from the other side of the desk', goal: 'Single, soft Playbook reminder' },
  { id: 'upsell_failed', trigger: 'upsell_failed', delay: 'immediate', subject: 'Your Playbook payment didn’t go through', goal: 'Offer retry, no pressure' },
  // Recovery (stop immediately on purchase_completed)
  { id: 'abandon_1h', trigger: 'checkout_abandoned', delay: '1 hour', subject: 'Your RentReady order is saved', goal: 'Secure return link to /checkout', exit: 'purchase_completed' },
  { id: 'abandon_24h', trigger: 'checkout_abandoned', delay: '24 hours', subject: 'Fair questions before you buy', goal: 'Answer objections (credit, guarantee, delivery)', exit: 'purchase_completed' },
  { id: 'abandon_72h', trigger: 'checkout_abandoned', delay: '72 hours', subject: 'What a property may see before you do', goal: 'Educational value + return link', exit: 'purchase_completed' },
  { id: 'abandon_6d', trigger: 'checkout_abandoned', delay: '6 days', subject: 'Your free before-you-apply checklist', goal: 'Final helpful note; no more recovery emails after this', exit: 'purchase_completed' },
  { id: 'payment_failed', trigger: 'payment_failed', delay: '30 minutes', subject: 'Your payment didn’t go through', goal: 'Reassure (not charged) + retry link', exit: 'purchase_completed' },
  // Early-stage nurture (marketing consent required)
  { id: 'checklist_delivery', trigger: 'free_resource_requested', delay: 'immediate', subject: 'Your Before-You-Apply Checklist', goal: 'Deliver the free resource' },
  { id: 'nurture_1', trigger: 'free_resource_requested', delay: '2 days', subject: 'Why “I can afford it” isn’t the whole application', goal: 'Education → book', exit: 'purchase_completed' },
  { id: 'nurture_2', trigger: 'free_resource_requested', delay: '5 days', subject: 'Know before they know', goal: 'Education → options', exit: 'purchase_completed' },
  { id: 'access_link', trigger: 'access_link_requested', delay: 'immediate', subject: 'Your RentReady sign-in link', goal: 'Transactional: send data.link (expires in 30 minutes, single use)' },
  { id: 'refund_confirmation', trigger: 'refund_processed', delay: 'immediate', subject: 'Your refund is on its way', goal: 'Confirm refund, suppress all sales emails' },
];

export interface OutboxItem {
  event: LifecycleEvent;
  at: string;
  data?: Record<string, string | number | boolean | undefined>;
}

export async function emitLifecycle(event: LifecycleEvent, data?: OutboxItem['data']) {
  const item: OutboxItem = { event, at: new Date().toISOString(), data };
  if (isMock) {
    const box = read<OutboxItem[]>('mock.outbox', []);
    box.push(item);
    write('mock.outbox', box.slice(-60));
    return;
  }
  try {
    await api('/lifecycle', { json: item });
  } catch {
    /* non-blocking */
  }
}

export const getMockOutbox = () => read<OutboxItem[]>('mock.outbox', []);
