import { bearerOk, body, fail, json, notConfigured, type Ctx } from '../../_lib';
import { CLASSIFICATIONS, type Classification, type ListingRow } from '../../listings';

/**
 * GET  /api/admin/listings — all RentReady listings with verification status.
 * POST /api/admin/listings { …listing } — add or update one. A verified second-chance listing needs the source page
 * that states its screening policy and the date it was checked. Only add listings you are permitted to publish.
 */
const t = (v: unknown, n: number) => (v == null || v === '' ? null : String(v).replace(/[<>]/g, '').trim().slice(0, n) || null);
const num = (v: unknown) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const https = (v: string | null) => !v || /^https:\/\/[^\s]+$/.test(v);

export const onRequestGet = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.ADMIN_TOKEN) return notConfigured('Admin listings');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const rows = (await env.DB.prepare('SELECT * FROM rr_listings ORDER BY updated_at DESC LIMIT 500').bind().all<ListingRow>()).results;
  const stale = new Date(Date.now() - 30 * 86400000).toISOString();
  return json({ listings: rows.map((r) => ({ ...r, needs_reverification: r.classification === 'verified_second_chance' && (!r.verified_at || r.verified_at < stale) })) });
};

export const onRequestPost = async ({ request, env }: Ctx) => {
  if (!env.DB || !env.ADMIN_TOKEN) return notConfigured('Admin listings');
  if (!bearerOk(request, env.ADMIN_TOKEN)) return fail(401, 'Unauthorized.');
  const b = await body<Record<string, unknown>>(request).catch(() => null);
  if (!b) return fail(400, 'Invalid request.');
  const classification = String(b.classification) as Classification;
  if (!CLASSIFICATIONS.includes(classification)) return fail(422, 'Choose a classification.');
  const row = {
    name: t(b.name, 120), address: t(b.address, 200), city: t(b.city, 80), state: t(b.state, 2)?.toUpperCase() || null,
    rent_cents: num(b.rent_cents), beds: num(b.beds), baths: num(b.baths), description: t(b.description, 2000), phone: t(b.phone, 40),
    website: t(b.website, 300), photo_url: t(b.photo_url, 500), screening_note: t(b.screening_note, 600),
    source_name: t(b.source_name, 120), source_url: t(b.source_url, 500), verified_at: t(b.verified_at, 30),
  };
  if (!row.name || !row.city || !row.state || !/^[A-Z]{2}$/.test(row.state)) return fail(422, 'Name, city and two-letter state are required.');
  if (!row.source_name || !row.source_url || !https(row.source_url)) return fail(422, 'Every listing needs its source name and an https source URL.');
  if (!https(row.website) || !https(row.photo_url)) return fail(422, 'Website and photo links must start with https://');
  if (classification === 'verified_second_chance' && (!row.verified_at || Number.isNaN(Date.parse(row.verified_at)) || !row.screening_note)) {
    return fail(422, 'A verified second-chance listing needs the verification date and a note quoting what the source says about screening.');
  }
  const id = t(b.listing_id, 80) || `lst_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  if (!/^[\w-]{3,80}$/.test(id)) return fail(422, 'Invalid listing id.');
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO rr_listings (listing_id, classification, name, address, city, state, rent_cents, beds, baths, description, phone, website, photo_url, screening_note, source_name, source_url, verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(listing_id) DO UPDATE SET classification = excluded.classification, name = excluded.name, address = excluded.address, city = excluded.city, state = excluded.state,
       rent_cents = excluded.rent_cents, beds = excluded.beds, baths = excluded.baths, description = excluded.description, phone = excluded.phone, website = excluded.website,
       photo_url = excluded.photo_url, screening_note = excluded.screening_note, source_name = excluded.source_name, source_url = excluded.source_url, verified_at = excluded.verified_at, updated_at = excluded.updated_at`,
  ).bind(id, classification, row.name, row.address, row.city, row.state, row.rent_cents, row.beds, row.baths, row.description, row.phone, row.website, row.photo_url,
    row.screening_note, row.source_name, row.source_url, row.verified_at, now, now).run();
  return json({ ok: true, listing_id: id });
};
