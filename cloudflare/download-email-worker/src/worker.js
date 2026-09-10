const PRODUCTS = {
  modern: {
    entitlementField: 'paid27',
    category: 'modern',
    subject: 'Your RentReady Modern Apartment Download',
    filename: 'RentReady Guide.zip',
    envKey: 'MODERN_DOWNLOAD_KEY',
    defaultKey: 'RentReady Guide.zip',
  },
  luxury: {
    entitlementField: 'paid27',
    category: 'luxury',
    subject: 'Your RentReady Luxury Apartment Download',
    filename: 'RentReady Guide.zip',
    envKey: 'LUXURY_DOWNLOAD_KEY',
    defaultKey: 'RentReady Guide.zip',
  },
  gameplan: {
    entitlementField: 'paid27',
    subject: 'Your RentReady Game Plan',
    filename: 'RentReady-Game-Plan.pdf',
    envKey: 'GAMEPLAN_DOWNLOAD_KEY',
    defaultKey: 'gameplan.pdf',
  },
  creditkit: {
    entitlementField: 'paid97',
    subject: 'Your RentReady Credit Action Kit',
    filename: 'RentReady-Credit-Action-Kit.pdf',
    envKey: 'CREDITKIT_DOWNLOAD_KEY',
    defaultKey: 'creditkit.pdf',
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(email));
}

function base64UrlEncode(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(body, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
}

async function sign(payload, env) {
  if (!env.EMAIL_LINK_SECRET) throw new Error('EMAIL_LINK_SECRET is not configured.');
  const ttl = Number(env.DOWNLOAD_LINK_TTL_SECONDS || 604800);
  const body = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    ...payload,
    exp: Date.now() + Math.max(60, ttl) * 1000,
  })));
  const mac = base64UrlEncode(await hmac(body, env.EMAIL_LINK_SECRET));
  return `${body}.${mac}`;
}

async function verify(token, env) {
  if (!env.EMAIL_LINK_SECRET || !token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = base64UrlEncode(await hmac(body, env.EMAIL_LINK_SECRET));
  if (mac !== expected) return null;
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function supabaseConfig(env) {
  const url = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase is not configured.');
  return { url, key };
}

async function supabaseGet(env, path) {
  const config = supabaseConfig(env);
  const res = await fetch(`${config.url}/rest/v1/${path}`, {
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} failed: ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function getLead(env, leadId) {
  return supabaseGet(env, `leads?id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`);
}

async function getEntitlements(env, leadId) {
  return supabaseGet(env, `entitlements?lead_id=eq.${encodeURIComponent(leadId)}&select=*&limit=1`);
}

function hasEntitlement(entitlements, product, def) {
  if (!entitlements || !entitlements[def.entitlementField]) return false;
  if (def.category && entitlements.purchased_category !== def.category) return false;
  return product === 'modern' || product === 'luxury' || entitlements[def.entitlementField] === true;
}

function r2KeyFor(env, def) {
  return env[def.envKey] || def.defaultKey;
}

function publicBaseUrl(request, env) {
  return String(env.PUBLIC_WORKER_URL || new URL(request.url).origin).replace(/\/+$/, '');
}

function authorized(request, env) {
  if (!env.TRIGGER_SECRET) return false;
  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return bearer === env.TRIGGER_SECRET || request.headers.get('x-trigger-secret') === env.TRIGGER_SECRET;
}

async function sendEmailWithResend(env, { to, firstName, subject, downloadUrl }) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
    throw new Error('RESEND_API_KEY and FROM_EMAIL are required for email delivery.');
  }
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to,
      subject,
      text: `${greeting}\n\nYour RentReady download is ready:\n${downloadUrl}\n\nThis secure link expires soon.`,
      html: `<p>${greeting}</p><p>Your RentReady download is ready:</p><p><a href="${downloadUrl}">Download your file</a></p><p>This secure link expires soon.</p>`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend email failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function handleSendDownload(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!authorized(request, env)) return json({ ok: false, error: 'Unauthorized.' }, 401);

  const body = await request.json().catch(() => null);
  const leadId = String((body && body.leadId) || '').trim();
  const product = String((body && (body.product || body.category)) || '').trim().toLowerCase();
  const def = PRODUCTS[product];
  if (!leadId || !def) return json({ ok: false, error: 'Missing or invalid fields.' }, 400);

  const [lead, entitlements] = await Promise.all([getLead(env, leadId), getEntitlements(env, leadId)]);
  if (!hasEntitlement(entitlements, product, def)) {
    return json({ ok: false, error: 'This download is not unlocked yet.' }, 403);
  }

  const email = normalizeEmail(lead && lead.email);
  if (!isValidEmail(email)) {
    return json({ ok: false, error: 'No valid email is on file for this lead.' }, 400);
  }

  const key = r2KeyFor(env, def);
  const object = await env.DOWNLOADS.head(key);
  if (!object) return json({ ok: false, error: `R2 object was not found: ${key}` }, 404);

  const token = await sign({ leadId, product }, env);
  const downloadUrl = `${publicBaseUrl(request, env)}/download?token=${encodeURIComponent(token)}`;
  await sendEmailWithResend(env, {
    to: email,
    firstName: lead.first_name || '',
    subject: def.subject,
    downloadUrl,
  });

  return json({ ok: true, emailed: true, to: email });
}

async function handleDownload(request, env) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  const token = new URL(request.url).searchParams.get('token') || '';
  const payload = await verify(token, env);
  const def = payload && PRODUCTS[payload.product];
  if (!payload || !payload.leadId || !def) {
    return new Response('This link has expired. Request a new one from the site.', { status: 403 });
  }

  const entitlements = await getEntitlements(env, payload.leadId);
  if (!hasEntitlement(entitlements, payload.product, def)) {
    return new Response('This file is not unlocked for this account yet.', { status: 403 });
  }

  const key = r2KeyFor(env, def);
  const object = await env.DOWNLOADS.get(key);
  if (!object) return new Response('This file has not been uploaded yet.', { status: 404 });

  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || (def.filename.endsWith('.zip') ? 'application/zip' : 'application/pdf'),
      'Content-Disposition': `attachment; filename="${def.filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/send-download') return await handleSendDownload(request, env);
      if (path === '/download') return await handleDownload(request, env);
      return json({ ok: false, error: 'Not found.' }, 404);
    } catch (err) {
      console.error('download email worker error', err);
      return json({ ok: false, error: 'Could not process the download email flow.' }, 500);
    }
  },
};
