import { RESOURCES } from '../../src/config/resources';
import type { Env, ProductId } from './_lib';

/**
 * Transactional email sent directly through Resend (RESEND_API_KEY + FROM_EMAIL): purchase receipts with
 * download links, the "your book has shipped" update and sign-in links. Marketing/recovery flows stay with the
 * ESP webhook. Without the Resend settings nothing is sent and the fact is still stored in rr_lifecycle_events.
 */

const NAMES: Record<ProductId, string> = {
  guide: 'Before They Say No™ (physical book)',
  creditready: 'RentReady Digital Bundle',
  upgrade: 'RentReady Digital Bundle upgrade',
  playbook: 'The Property Manager Playbook',
};
const SHIPS: ProductId[] = ['guide', 'creditready'];
const LINK_DAYS = 30;

export const siteOrigin = (env: Env) => (env.ALLOWED_ORIGIN || 'https://werentreadygo.com').replace(/\/+$/, '');

// ---------------------------------------------------------------- signed download links
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`download:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))));
}

/** A link that works without a browser session: /api/files?t=… (entitlement is re-checked on every click). */
export async function emailDownloadUrl(env: Env, customerId: string, key: string) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ c: customerId, k: key, exp: Date.now() + LINK_DAYS * 86400000 })));
  return `${siteOrigin(env)}/api/files?t=${payload}.${await sign(env.SESSION_SECRET!, payload)}`;
}

export async function readDownloadToken(env: Env, token: string): Promise<{ customerId: string; key: string } | null> {
  const [payload, mac] = token.split('.');
  if (!env.SESSION_SECRET || !payload || !mac || mac !== (await sign(env.SESSION_SECRET, payload))) return null;
  try {
    const bin = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as { c: string; k: string; exp: number };
    return p.exp > Date.now() && p.c && p.k ? { customerId: p.c, key: p.k } : null;
  } catch {
    return null;
  }
}

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

/** Receipt: order summary, download links for digital products, and the shipping promise for the book. */
export async function receiptEmail(env: Env, to: Recipient, d: { product: ProductId; amount_cents: number; order_id: string; customer_id?: string }) {
  const hi = to.first_name ? `Hi ${esc(to.first_name)},` : 'Hi,';
  const owned: ProductId = d.product === 'upgrade' ? 'creditready' : d.product;
  const links = d.customer_id
    ? await Promise.all(RESOURCES.filter((r) => r.product === owned).map(async (r) => ({ title: r.kind === 'Video' ? 'Watch the step-by-step video guide' : `Download: ${r.title.replace(/ \(ZIP download\)$/, '')}`, url: await emailDownloadUrl(env, d.customer_id!, r.fileKey) })))
    : [];
  const ships = SHIPS.includes(d.product);
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  let body = p(hi) + p(`Here’s your receipt${links.length ? ' and your downloads' : ''}.`);
  body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 22px;border:1px solid #e7dfcf;border-radius:12px;font-size:15px">
<tr><td style="padding:14px 16px;border-bottom:1px solid #e7dfcf">${esc(NAMES[d.product])}</td><td align="right" style="padding:14px 16px;border-bottom:1px solid #e7dfcf;font-weight:700">${money(d.amount_cents)}</td></tr>
<tr><td style="padding:10px 16px;color:#4f596b">Order ${esc(d.order_id)}<br>${date}</td><td align="right" style="padding:10px 16px;color:#4f596b">Paid · USD<br>One-time, no subscription</td></tr></table>`;
  if (links.length) {
    body += `<h2 style="margin:0 0 10px;font-size:18px">Your digital files</h2>`;
    body += links.map((l, i) => (i === 0 ? button(l.url, l.title) : p(`<a href="${esc(l.url)}" style="color:#7a5a24;font-weight:600">${esc(l.title)} →</a>`))).join('');
    body += p(`<span style="font-size:14px;color:#4f596b">These links are private to you and work for ${LINK_DAYS} days. Any time after that, sign in at <a href="${siteOrigin(env)}/access" style="color:#7a5a24">${esc(siteOrigin(env).replace(/^https?:\/\//, ''))}/access</a> with this email.</span>`);
  }
  if (ships) {
    body += `<h2 style="margin:22px 0 10px;font-size:18px">Your book is on its way</h2>`;
    body += p('Your physical copy of <strong>Before They Say No™</strong> is being prepared for shipping to the address you entered at checkout. We’ll email you again as soon as it ships.');
  }
  const subject = ships ? 'Your RentReady receipt — your book is on its way' : 'Your RentReady receipt and downloads';
  const text = [
    to.first_name ? `Hi ${to.first_name},` : 'Hi,',
    '',
    `Thank you for your order: ${NAMES[d.product]} — ${money(d.amount_cents)} (order ${d.order_id}, ${date}).`,
    ...(links.length ? ['', 'Your digital files:', ...links.map((l) => `${l.title}: ${l.url}`), `Links work for ${LINK_DAYS} days; after that sign in at ${siteOrigin(env)}/access.`] : []),
    ...(ships ? ['', 'Your physical copy of Before They Say No™ is being prepared for shipping. We’ll email you again as soon as it ships.'] : []),
    '',
    `Questions? ${supportEmail(env)}`,
  ].join('\n');
  return sendEmail(env, to.email, subject, layout(env, 'Thank you for your order', body), text);
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
  const body = p(to.first_name ? `Hi ${esc(to.first_name)},` : 'Hi,') + p('Use this button to open your RentReady access page. It works once and expires in 30 minutes.') + button(link, 'Open my RentReady access') +
    p('<span style="font-size:14px;color:#4f596b">Didn’t ask for this? You can ignore this email.</span>');
  return sendEmail(env, to.email, 'Your RentReady sign-in link', layout(env, 'Your sign-in link', body), `Open your RentReady access (works once, expires in 30 minutes): ${link}`);
}

/** Lifecycle events that trigger a transactional email. Called once per stored (non-duplicate) event. */
export async function sendTransactional(env: Env, to: Recipient, event: string, data: Record<string, unknown>) {
  if (event === 'purchase_completed') return receiptEmail(env, to, data as Parameters<typeof receiptEmail>[2]);
  if (event === 'order_shipped') return shippedEmail(env, to, data as Parameters<typeof shippedEmail>[2]);
  if (event === 'access_link_requested') return accessLinkEmail(env, to, String(data.link));
  return false;
}
