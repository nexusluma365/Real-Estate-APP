# RentReady — digital products & automatic delivery

Since 2026-11 RentReady sells two digital products only. Nothing ships.

| Offer | Price | Product id | What the buyer gets |
|---|---|---|---|
| RentReady Digital eBook | $39.99 | `guide` | *Know Before They Say NO!* eBook (PDF) |
| RentReady Complete Digital Bundle | $79.99 | `creditready` | The eBook + 20 editable dispute letters (ZIP of Word files) + video guides |

The ids are unchanged so existing orders and access keep working. The **$40 upgrade** (`upgrade`) and the **$100
Property Manager Playbook** (`playbook`) are retired: the server refuses to start either (`/api/payments/intent` → 400,
`/api/upsell/charge` and `/api/payments/save-method` → 410), `/complete-your-system` redirects to `/welcome`, and no page
links to them. People who already bought them keep everything.

## What happens on a sale

```
Checkout (/checkout) ─► Stripe payment ─► /api/payments/verify (server checks Stripe) ─► /welcome: downloads right away
                                   └────► Stripe webhook payment_intent.succeeded (source of truth)
                                            ├─ order + access recorded (rr_orders, rr_entitlements; fulfillment='digital', affiliate id)
                                            └─ deliverOrder(): “Your RentReady Digital Package Is Ready!” email (once per order)
                                                   └─ failed? logged in rr_deliveries, retried every 10 min (delivery-retry) for 3 days
```

- **Nothing is delivered before Stripe confirms the payment.** The email is sent only from the verified webhook.
- **No file or file URL is ever emailed.** The button is a 7-day sign-in link to `/access`; every download there is a
  fresh 1-minute signed URL from the private R2 bucket (`/api/files`). After 7 days the buyer enters their email on
  `/access` for a new link — access never expires.
- **Exactly once:** Stripe retrying the webhook, or sending a second event for the same payment, never sends a second email.
- **Retries:** 2, 4, 8 … minutes apart, up to 8 attempts within 3 days. Paid orders whose email never started (e.g. a
  crash mid-webhook) are picked up too.
- **Support:** `/admin` → *Digital deliveries* shows every order's email status, attempts and last error, with
  *Send now* / *Resend*. API: `GET/POST /api/admin/deliveries`.
- **Refunds:** a full refund removes access to what that order granted. **Chargebacks:** an opened dispute removes it;
  a dispute closed as *won* restores it (unless refunded).
- **Older checkouts:** a payment started before the switch (price + the old $9.99 shipping) is still honored and delivered.
- **Older physical orders** (before the switch) stay in `/admin` → *Books to ship* until shipped. New orders never appear there.

## Setup checklist (one time)

1. **Database migration.** Run once (adds `rr_deliveries` and new columns; safe to repeat):
   `curl -X POST https://werentreadygo.com/api/admin/migrate -H "Authorization: Bearer $ADMIN_TOKEN"`
   Fresh databases get everything from `schema.sql`.
2. **Upload the eBook** to the private R2 bucket under this exact key (with spaces):
   `ebook/Know Before They Say NO - RentReady eBook.pdf` — use `~/Desktop/Know Before They Say No.pdf` (24.6 MB).
   Keep the bucket private. `/api/admin/health` → `files` shows `uploaded` when it's there.
   The letters ZIP (`CREDIT REPAIR TOOLKIT™.zip`) and `VIDEO_GUIDE_URL` are unchanged.
3. **Email (Resend)** — already used for sign-in links. Make sure these are set in Netlify:
   `RESEND_API_KEY`, `FROM_EMAIL` (a verified sender, e.g. `RentReady <support@send.werentreadygo.com>`), `SUPPORT_EMAIL`,
   `ALLOWED_ORIGIN=https://werentreadygo.com` (links in emails use it). `/api/admin/health` → `delivery_email: true`.
   Resend's free tier covers 3,000 emails/month; no new service is needed.
4. **Stripe webhook** (Dashboard → Developers → Webhooks → `https://werentreadygo.com/api/webhooks/stripe`). Events:
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, **`charge.dispute.created`**,
   **`charge.dispute.closed`** (new), plus the Premium events: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
5. **Scheduled function.** `netlify/functions/delivery-retry.mts` runs every 10 minutes automatically on Netlify. Check
   it under Netlify → Functions → delivery-retry.
6. **ESP / email automation.** The delivery email is sent by the server — don't also send an order confirmation from the
   ESP. Turn off the retired flows: `upgrade_offer`, `upsell_decline_followup`, `upsell_failed`.
7. **No new environment variables** are required. `VITE_PHYSICAL_DELIVERY_NOTE` is no longer used and can be deleted.

## Affiliate tracking — read this before promoting with ClickBank

What's built (works with the current Stripe checkout):
- An affiliate id in any landing link — `?hop=` (ClickBank's hoplink parameter), `?aff=`, `?ref=` or `?affiliate=` — is
  remembered for 60 days (latest referral wins), sent with checkout, saved in the Stripe PaymentIntent metadata
  (`affiliate`), on the order (`rr_orders.affiliate`) and the lead, and reported in `/admin` → *Sales by affiliate*
  (orders, refunds, net revenue) and `GET /api/admin/metrics` → `byAffiliate`.

What this does **not** do:
- **ClickBank does not see or pay commission on Stripe sales.** ClickBank credits affiliates only for orders placed
  through ClickBank's own order form, where ClickBank is the retailer. The affiliate page currently says sales are
  "tracked through ClickBank"; with the Stripe checkout that isn't true yet. Choose one:
  1. **Sell through ClickBank** for affiliate traffic: create the two products in ClickBank, send affiliates' buyers to
     ClickBank's order form, and set the ClickBank Thank-You page to deliver access (a ClickBank INS/IPN endpoint that
     creates the order and sends the package email can be added — it needs your ClickBank secret key to verify notifications).
  2. **Keep Stripe** and pay affiliates yourself from the *Sales by affiliate* report (or a Stripe-based affiliate tool),
     and change the affiliate page's ClickBank wording.
- The affiliate page advertises 38% to start and up to 60% with tiers; make sure that matches the terms you set.

## Launch test plan (Stripe test mode)

1. Buy the eBook with card `4242 4242 4242 4242` → land on `/welcome` with the eBook download; receive one email.
2. Open the email's button on a second device → signed in on `/access`, eBook downloads (`.pdf`).
3. Buy the Bundle with another email → email lists eBook, letters, videos; all three open.
4. Card `4000 0000 0000 0002` → declined message, no access, no email.
5. In Stripe, *Resend* the `payment_intent.succeeded` event → still one email.
6. Temporarily break `RESEND_API_KEY` → buy → `/admin` shows *failed*; restore it → within ~10 minutes *sent*.
7. Visit `/?hop=testaff`, buy → `/admin` → *Sales by affiliate* shows `testaff`.
8. Refund the Bundle in Stripe → its downloads stop working. Open + win a test dispute → access returns.
9. Try `/checkout?product=upgrade` (opens the Bundle) and `/complete-your-system` (goes to `/welcome`).

Automated: `npm run check` covers 1–5, 6, 7 (server side), 8 and 9 against a simulated Stripe and email provider.
