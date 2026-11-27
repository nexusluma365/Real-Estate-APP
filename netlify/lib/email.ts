import type { Env, ProductId } from './_lib';

/**
 * Transactional email sent directly through Resend (RESEND_API_KEY + FROM_EMAIL): the digital package delivery email
 * (sent by netlify/lib/delivery.ts after Stripe confirms payment; it carries a 7-day access link, never a file or a
 * file URL), sign-in links and — for orders placed before the digital switch — the "your book has shipped" update. Marketing/recovery flows stay with the
 * ESP webhook. Without the Resend settings nothing is sent and the fact is still stored in rr_lifecycle_events.
 */

const NAMES: Record<ProductId, string> = {
  guide: 'RentReady Digital eBook',
  creditready: 'RentReady Complete Digital Bundle',
  upgrade: 'RentReady Complete Digital Bundle (upgrade)',
  playbook: 'The Property Manager Playbook',
};

/** What's inside each package, exactly as delivered (the eBook, letters and videos live on the access page). */
export const PACKAGE_ITEMS: Record<ProductId, string[]> = {
  guide: ['Know Before They Say NO! — Digital eBook'],
  creditready: ['Know Before They Say NO! — Digital eBook', '20 Editable Credit Dispute Letters', 'Video Education Guides'],
  upgrade: ['Know Before They Say NO! — Digital eBook', '20 Editable Credit Dispute Letters', 'Video Education Guides'],
  playbook: ['The Property Manager Playbook and its worksheets'],
};

/** Short, readable order reference for support conversations (the full Stripe id is kept in the database). */
export const orderRef = (orderId: string) => `RR-${orderId.replace(/^pi_/, '').slice(-8).toUpperCase()}`;

export const siteOrigin = (env: Env) => (env.ALLOWED_ORIGIN || 'https://werentreadygo.com').replace(/\/+$/, '');

// ---------------------------------------------------------------- sending
export async function sendEmail(env: Env, to: string, subject: string, html: string, text: string) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.FROM_EMAIL, to, subject, html, text, reply_to: supportEmail(env) }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return true;
}

const supportEmail = (env: Env) => env.SUPPORT_EMAIL || 'support@werentreadygo.com';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function layout(env: Env, heading: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f6f0e4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0b1426">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden">
<tr><td style="background:#0a1730;padding:22px 32px;color:#efd69e;font-size:18px;font-weight:700;letter-spacing:-.01em">RentReady</td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.2;letter-spacing:-.02em">${heading}</h1>
${body}
<p style="margin:28px 0 0;font-size:14px;line-height:1.5;color:#4f596b">Questions? Reply to this email or write to <a href="mailto:${esc(supportEmail(env))}" style="color:#7a5a24">${esc(supportEmail(env))}</a>.</p>
</td></tr></table>
<p style="max-width:560px;margin:18px auto 0;font-size:12px;line-height:1.5;color:#4f596b">RentReady · ${esc(siteOrigin(env).replace(/^https?:\/\//, ''))}<br>Educational resource. Does not guarantee apartment approval, credit score changes or removal of any information.</p>
</td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.55">${html}</p>`;
const button = (href: string, label: string) =>
  `<p style="margin:6px 0 12px"><a href="${esc(href)}" style="display:inline-block;background:#d4af6a;color:#0b1426;text-decoration:none;font-weight:700;font-size:16px;padding:14px 26px;border-radius:999px">${esc(label)}</a></p>`;

export interface Recipient { email: string; first_name: string }

/**
 * "Your RentReady Digital Package Is Ready!" — sent once per paid order, after Stripe confirms the payment.
 * The button is a 7-day sign-in link to /access, where every file is served through a 1-minute signed URL.
 */
export async function packageEmail(env: Env, to: Recipient, d: { product: ProductId; amount_cents: number; order_id: string; access_link: string; link_days: number }) {
  const items = PACKAGE_ITEMS[d.product];
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const support = supportEmail(env);
  const accessPage = `${siteOrigin(env)}/access`;
  const bundle = d.product !== 'guide';
  const gold = '#d4af6a';
  const muted = 'color:#4f596b';

  let body = p(to.first_name ? `Hi ${esc(to.first_name)},` : 'Hi,') +
    p('Thank you for choosing RentReady! Your digital education package is ready. Everything you purchased is now available for you to access.');
  body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;border:1px solid #e7dfcf;border-radius:12px;font-size:15px">
<tr><td style="padding:14px 16px;border-bottom:1px solid #e7dfcf"><strong>${esc(NAMES[d.product])}</strong></td><td align="right" style="padding:14px 16px;border-bottom:1px solid #e7dfcf;font-weight:700">${money(d.amount_cents)}</td></tr>
<tr><td style="padding:10px 16px;${muted}">Order <span style="white-space:nowrap">${esc(orderRef(d.order_id))}</span><br><span style="white-space:nowrap">${date}</span></td><td align="right" style="padding:10px 16px;${muted}">Paid · USD<br>One-time · Digital delivery</td></tr></table>`;
  body += `<h2 style="margin:0 0 12px;font-size:18px">Here’s what’s inside your package</h2>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;font-size:16px">${items.map((i) => `<tr><td valign="top" style="padding:4px 10px 4px 0;color:${gold};font-weight:700">✓</td><td style="padding:4px 0">${esc(i)}</td></tr>`).join('')}</table>`;
  body += `<p style="margin:8px 0 10px;text-align:center"><a href="${esc(d.access_link)}" style="display:inline-block;background:${gold};color:#0b1426;text-decoration:none;font-weight:800;font-size:16px;letter-spacing:.04em;padding:16px 28px;border-radius:999px">ACCESS MY DIGITAL PACKAGE</a></p>`;
  body += p(`<span style="font-size:14px;${muted}">Your purchase is yours to access. Save this email so you can easily return to your materials. This button signs you in for the next ${d.link_days} days; after that, go to <a href="${esc(accessPage)}" style="color:#7a5a24">${esc(accessPage.replace(/^https?:\/\//, ''))}</a> and enter this email address for a fresh link — your access doesn’t expire.</span>`);
  body += `<h2 style="margin:22px 0 8px;font-size:16px">Opening your files</h2>` +
    p(`<span style="font-size:14px;${muted}">Your eBook is a PDF — it opens in any web browser, Apple Books, Google Play Books or Adobe Acrobat Reader, on your phone or computer.${bundle ? ' Your 20 dispute letters download as one ZIP file of Microsoft Word documents — open it on a computer, then edit the letters in Word, Google Docs or Pages. Your video guides play right in your browser from the same page.' : ''} Each download button makes a fresh, private link, so you can download again any time.</span>`);
  body += `<p style="margin:26px 0 0;font-size:16px;line-height:1.55;font-style:italic;color:#0b1426">Knowledge changes how you prepare. Now you have the tools to take your next step with confidence.</p>
<p style="margin:14px 0 0;font-size:15px;line-height:1.5"><strong>RentReady Education</strong><br><span style="${muted}">By Nexus Luma LLC</span></p>`;

  const text = [
    to.first_name ? `Hi ${to.first_name},` : 'Hi,',
    '',
    'Thank you for choosing RentReady! Your digital education package is ready.',
    '',
    `${NAMES[d.product]} — ${money(d.amount_cents)} · Order ${orderRef(d.order_id)} · ${date}`,
    '',
    'Here’s what’s inside your package:',
    ...items.map((i) => `  ✓ ${i}`),
    '',
    `ACCESS MY DIGITAL PACKAGE: ${d.access_link}`,
    `(This link signs you in for ${d.link_days} days. After that, visit ${accessPage} and enter this email for a fresh link — your access doesn’t expire.)`,
    '',
    `Your eBook is a PDF and opens in any browser or reader app.${bundle ? ' The 20 letters are Microsoft Word files in one ZIP — open it on a computer. Videos play in your browser.' : ''}`,
    '',
    'Knowledge changes how you prepare. Now you have the tools to take your next step with confidence.',
    '',
    'RentReady Education',
    'By Nexus Luma LLC',
    '',
    `Questions? ${support}`,
  ].join('\n');
  return sendEmail(env, to.email, 'Your RentReady Digital Package Is Ready!', layout(env, 'Your Next Chapter Starts Here.', body), text);
}

export async function shippedEmail(env: Env, to: Recipient, d: { carrier?: string; tracking?: string; tracking_url?: string }) {
  const hi = to.first_name ? `Hi ${esc(to.first_name)},` : 'Hi,';
  const track = d.tracking ? `${d.carrier ? `${esc(d.carrier)} ` : ''}tracking number: <strong>${esc(d.tracking)}</strong>` : '';
  let body = p(hi) + p('Good news — your copy of <strong>Before They Say No™</strong> has shipped.');
  if (track) body += p(track);
  if (d.tracking_url) body += button(d.tracking_url, 'Track your package');
  const text = [to.first_name ? `Hi ${to.first_name},` : 'Hi,', '', 'Your copy of Before They Say No™ has shipped.', d.tracking ? `${d.carrier || ''} tracking: ${d.tracking}`.trim() : '', d.tracking_url || '', '', `Questions? ${supportEmail(env)}`].filter((l, i, a) => l || a[i - 1]).join('\n');
  return sendEmail(env, to.email, 'Your RentReady book has shipped', layout(env, 'Your book has shipped', body), text);
}

export async function accessLinkEmail(env: Env, to: Recipient, link: string) {
  const body = p(to.first_name ? `Hi ${esc(to.first_name)},` : 'Hi,') + p('Use this button to sign in to RentReady. It works once and expires in 30 minutes.') + button(link, 'Sign in to RentReady') +
    p('<span style="font-size:14px;color:#4f596b">Didn’t ask for this? You can ignore this email.</span>');
  return sendEmail(env, to.email, 'Your RentReady sign-in link', layout(env, 'Your sign-in link', body), `Sign in to RentReady (works once, expires in 30 minutes): ${link}`);
}

/** The search link the apartment-match questionnaire promises ("Where can we send your search link?"). */
export async function searchLinkEmail(env: Env, to: Recipient, place: string) {
  const link = `${siteOrigin(env)}/finder/?q=${encodeURIComponent(place)}`;
  const body = p(to.first_name ? `Hi ${esc(to.first_name)},` : 'Hi,') + p(`Here’s your apartment search for <strong>${esc(place)}</strong>. Open it any time to pick up where you left off.`) +
    button(link, 'Open my apartment search') + p('<span style="font-size:14px;color:#4f596b">Searching is free. RentReady never runs a credit check.</span>');
  return sendEmail(env, to.email, 'Your RentReady apartment search', layout(env, 'Your apartment search', body), `Your apartment search for ${place}: ${link}\n\nSearching is free. RentReady never runs a credit check.`);
}

const day = (iso?: unknown) => (typeof iso === 'string' && iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null);
const hi = (to: Recipient) => p(to.first_name ? `Hi ${esc(to.first_name)},` : 'Hi,');
const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));

/** RentReady Premium billing emails: always factual about amounts, dates and how to cancel. */
async function premiumEmail(env: Env, to: Recipient, event: string, d: Record<string, unknown>) {
  const account = `${siteOrigin(env)}/account`;
  const finder = `${siteOrigin(env)}/finder/`;
  const parts: { subject: string; heading: string; lines: string[]; cta?: [string, string] } | null =
    event === 'premium_started' ? {
      subject: 'Welcome to RentReady Premium', heading: 'Your membership is active',
      lines: [`You now have RentReady Premium: second-chance listing details, saved apartments and searches, and new-listing alerts.`,
        d.trial
          ? `Billing: you haven’t been charged. Your free trial${d.current_period_end ? ` runs to ${day(d.current_period_end)}` : ''}; after that it renews at $19.99 per month until you cancel. Cancel before the trial ends and you won’t be charged.`
          : `Billing: your first month${d.current_period_end ? ` runs to ${day(d.current_period_end)}` : ''}. After that it renews at $19.99 per month until you cancel. You can cancel any time from your account — you keep access until the end of the period you paid for.`],
      cta: [finder, 'Find apartments'],
    } : event === 'premium_renewed' ? {
      subject: 'Your RentReady Premium receipt', heading: 'Membership renewed',
      lines: [`We received your payment of ${money(Number(d.amount_cents) || 0)} for another month of RentReady Premium. Manage or cancel any time from your account.`],
      cta: [account, 'Open my account'],
    } : event === 'premium_payment_failed' ? {
      subject: 'Action needed: your RentReady Premium payment didn’t go through', heading: 'Your payment didn’t go through',
      lines: [`We couldn’t collect ${money(Number(d.amount_cents) || 0)} for RentReady Premium. Your card issuer declined it or the card has expired.`,
        `${d.next_attempt ? `We’ll try again on ${day(d.next_attempt)}. ` : ''}Your access continues for up to 7 days while the payment is retried. You can pay or update your card securely using the button below.`],
      cta: d.pay_url ? [String(d.pay_url), 'Update payment'] : [account, 'Update payment'],
    } : event === 'premium_cancel_scheduled' ? {
      subject: 'Your RentReady Premium cancellation is confirmed', heading: 'Cancellation confirmed',
      lines: [`Your membership won’t renew. ${d.access_until ? `You keep Premium access until ${day(d.access_until)}, and you won’t be charged again.` : 'You won’t be charged again.'}`,
        `Changed your mind? You can restart from your account before then. Your saved apartments and searches stay in your account.`],
      cta: [account, 'Open my account'],
    } : event === 'premium_ended' ? {
      subject: 'Your RentReady Premium membership has ended', heading: 'Your membership has ended',
      lines: [`Your RentReady Premium membership is no longer active, and you won’t be charged again. Your saved apartments and searches are kept in case you come back.`],
      cta: [`${finder}?premium=offer`, 'Rejoin RentReady Premium'],
    } : event === 'listing_alert' ? {
      subject: `New apartments in ${String(d.place || 'your saved search')}`, heading: `New in ${esc(String(d.place || 'your search'))}`,
      lines: [...((d.items as string[]) || []).map((x) => `• ${esc(x)}`), `You’re getting this because alerts are on for this saved search. Turn alerts off any time in your account.`],
      cta: [account, 'See them in my account'],
    } : null;
  if (!parts) return false;
  const html = hi(to) + parts.lines.map((l) => p(l)).join('') + (parts.cta ? button(parts.cta[0], parts.cta[1]) : '');
  const text = [to.first_name ? `Hi ${to.first_name},` : 'Hi,', '', ...parts.lines.map(plain), ...(parts.cta ? ['', `${parts.cta[1]}: ${parts.cta[0]}`] : []), '', `Questions? ${supportEmail(env)}`].join('\n');
  return sendEmail(env, to.email, parts.subject, layout(env, parts.heading, html), text);
}

/** Lifecycle events that trigger a transactional email. Called once per stored (non-duplicate) event. */
export async function sendTransactional(env: Env, to: Recipient, event: string, data: Record<string, unknown>) {
  // purchase_completed: the package email is sent by netlify/lib/delivery.ts (logged and retried), not here.
  if (event === 'order_shipped') return shippedEmail(env, to, data as Parameters<typeof shippedEmail>[2]);
  if (event === 'access_link_requested') return accessLinkEmail(env, to, String(data.link));
  if (event.startsWith('premium_') || event === 'listing_alert') return premiumEmail(env, to, event, data);
  if (event === 'search_saved' && typeof data.place === 'string') return searchLinkEmail(env, to, data.place);
  return false;
}
