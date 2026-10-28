# RentReady — Email Sequences

Ready-to-paste copy for every flow in `src/lib/lifecycle.ts → EMAIL_FLOWS`. Build these in your ESP (Klaviyo,
Customer.io, etc.) triggered by the events RentReady POSTs to `ESP_WEBHOOK_URL`.

**Rules the ESP must enforce**
- **Transactional** (order confirmation, payment failed, refund, checklist delivery) → always send.
- **Everything else** → send only when the payload's `marketing_allowed` is `true`. Every email has an unsubscribe link.
  Sync unsubscribes back with `POST /api/esp/unsubscribe`.
- **Exit conditions:** each recovery or nurture flow stops the moment `purchase_completed` arrives for that `lead_id`.
  `refund_processed` suppresses all sales email for that lead.
- Merge fields: `{{first_name}}`, `{{data.product}}`, `{{data.checkout_url}}` (relative; prefix with the site URL).
- Never promise approval, score changes or deletions. Never invent deadlines.

---

## 1 · Post-purchase (trigger: `purchase_completed`)

### order_confirmation — immediate (transactional)
**Subject:** Your RentReady order is confirmed — here’s your access
> Hi {{first_name}},
>
> Thank you. Your order is confirmed.
>
> **Open your access:** https://werentreadygo.com/access
> On a new device? Use “Email me a sign-in link” on that page with this email address.
>
> **What happens next**
> - Your copy of Before They Say No™ ships to the address you entered.
> - Digital Bundle: your 20 dispute letter templates (Microsoft Word) and the step-by-step video guide are ready now on your access page.
> - Digital Bundle bonus: take the 5-minute readiness assessment to build your game plan.
>
> Questions? Just reply. A person reads every message.
> {{#if refund_days}}You’re covered by our {{refund_days}}-day money-back guarantee.{{/if}}

### start_reading — +1 day, Digital Bundle buyers (exit: `product_accessed`)
**Subject:** Start here while your book is on its way
> {{first_name}}, you don’t have to wait for the mail. Get your free reports from all three bureaus at
> AnnualCreditReport.com, then open the video guide. It walks you through disputing items you believe are
> inaccurate and using your letter templates. Knowing what’s there before they do is the whole point.
> → https://werentreadygo.com/access

### assessment_nudge — +4 days, Digital Bundle buyers only (exit: `assessment_complete`)
**Subject:** Your game plan takes about five minutes
> Your readiness assessment turns what you know about your rent, income, credit and timing into a plan with
> clear priorities. It’s private, it doesn’t check your credit, and it takes about five minutes.
> → https://werentreadygo.com/assessment

### before_you_apply — +2 days after `gameplan_completed`
**Subject:** Before you apply, ask these questions
> Before you pay your next application fee, ask the leasing office for its written screening criteria, whether
> it runs a hard or soft credit check, and how it treats collections or past rental balances. Your game plan
> lists the rest. → https://werentreadygo.com/gameplan#sec-questions

### upgrade_offer — +10 days, book-only buyers (single send)
**Subject:** Add the dispute letters and video guide for $32
> If you want the tools to act on what you’re reading, the RentReady Digital Bundle adds 20 Essential Credit
> Dispute Letter templates (edit them in Microsoft Word) and a step-by-step video guide on disputing negative items.
> Your $47.99 book purchase counts in full, so it’s $32, and nothing extra ships. No pressure, and this is the
> only time we’ll mention it.
> → https://werentreadygo.com/checkout?product=upgrade

### upsell_decline_followup — +5 days after `upsell_declined` (single send)
**Subject:** See your application from the other side of the desk
> Your Digital Bundle prepares your side of the application. The Property Manager Playbook ($100) covers the
> other side: how screening criteria are commonly written, three sample applications, questions to ask
> before you pay a fee, and what to do after a denial. If that would help, it’s on your access page.

### upsell_failed — immediate (transactional)
**Subject:** Your Playbook payment didn’t go through
> No charge was made, and your Digital Bundle is unaffected. If you still want the Playbook, you can add it
> from your access page anytime.

---

## 2 · Abandoned checkout (trigger: `checkout_abandoned`; exit: `purchase_completed`)
`/api/cron/abandoned` fires this once per checkout, 60+ minutes after the lead reached the payment form.

### abandon_1h — immediately on trigger (≈1 hour after leaving)
**Subject:** Your RentReady order is saved
> Hi {{first_name}}, you were one step from finishing. Your details are saved, so it takes about a minute.
> → https://werentreadygo.com{{data.checkout_url}}
> One-time payment. No subscription. Secure checkout by Stripe.

### abandon_24h — +23 hours
**Subject:** Fair questions before you buy
> Three questions people ask most before they buy:
> - **“Will it help if my credit is bad?”** That’s who it was written for. It won’t erase accurate history.
>   Nothing honest can. But you’ll know what’s there and how to prepare for it.
> - **“Does it guarantee approval?”** No, and be wary of anyone who says otherwise.
> - **“What if it’s not for me?”** {{refund_days}} days to ask for a full refund.
> → https://werentreadygo.com{{data.checkout_url}}

### abandon_72h — +2 days
**Subject:** What a property may see before you do
> Most renters picture the kitchen. The leasing office looks at credit, collections, rental history, income
> and a screening report. Each blind application can also mean another fee and sometimes another hard inquiry.
> Before They Say No™ shows you their side first. → https://werentreadygo.com/#options

### abandon_6d — +3 days (final recovery email)
**Subject:** Your free before-you-apply checklist
> Whether or not RentReady is right for you, this will help: the questions to ask before you pay an
> application fee, and the documents to have ready. → https://werentreadygo.com/checklist
> This is the last reminder about your order.

### payment_failed — +30 minutes after `payment_failed` (transactional; exit: `purchase_completed`)
**Subject:** Your payment didn’t go through
> No charge was made. Banks sometimes decline online purchases they don’t recognize. Trying another card, or
> approving the payment in your bank app, usually fixes it. → https://werentreadygo.com/checkout

---

## 3 · Early-stage nurture (trigger: `free_resource_requested`)

### checklist_delivery — immediate (transactional: they asked for it)
**Subject:** Your Before-You-Apply Checklist
> Here it is: https://werentreadygo.com/checklist (print it or save it as a PDF from that page).

### nurture_1 — +2 days (marketing; exit: `purchase_completed`)
**Subject:** Why “I can afford it” isn’t the whole application
> Income is often one part of a decision. Many properties also review credit, collections, rental history and
> a screening report, and their requirements vary. The checklist’s first question (“Can I see your written
> criteria?”) is the most useful one to ask.

### nurture_2 — +5 days (marketing; exit: `purchase_completed`)
**Subject:** Know before they know
> When you’re ready for the full picture, Before They Say No™ ($47.99, a physical book mailed to you) explains what a property may see,
> what may be hurting your chances, and how to prepare. → https://werentreadygo.com/#options

---

## 4 · Sign-in link (trigger: `access_link_requested`, transactional)
**Subject:** Your RentReady sign-in link
> Here’s your secure link to open your RentReady purchase on this device: {{data.link}}
> It works once and expires in 30 minutes. Didn’t ask for it? You can ignore this email.

## 5 · Refund (trigger: `refund_processed`, transactional)
**Subject:** Your refund is on its way
> Your refund has been processed. Banks usually show it within 5–10 business days. Thank you for giving
> RentReady a try. You won’t receive any more sales emails from us.
