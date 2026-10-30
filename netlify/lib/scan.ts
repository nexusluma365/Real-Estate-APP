import type { Env } from './_lib';

/**
 * Automatic second-chance checks.
 * For each apartment community Google lists in an area, read the property's OWN website (home page + up to two
 * likely pages such as "rental criteria" / "qualifications" / "apply"), ask OpenAI whether the site publishes a
 * second-chance or flexible-screening policy, and list it as `verified_second_chance` ONLY when the model's quote is
 * found word-for-word on the page. Published rent is kept only when its quote is on the page too. Everything else is
 * recorded as checked and never shown as second-chance.
 */

export const AUTO_SOURCE = 'Property website (checked automatically)';
const PAGE_CHARS = 9000;
const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 800_000;

export const ttlDays = (env: Env) => Math.max(1, Number(env.RENTREADY_VERIFICATION_TTL_DAYS) || 30);
export const dailyLimit = (env: Env) => Math.max(0, Number(env.SCAN_DAILY_LIMIT ?? 200));
export const areaKey = (city: string, state: string) => `${state.trim().toUpperCase()}|${city.trim().toLowerCase()}`;

// ---------------------------------------------------------------- safe fetching
/** Only public https sites: no IP literals, localhost or internal names, default port. */
export function safeUrl(raw: string | null | undefined): URL | null {
  try {
    const u = new URL(String(raw || ''));
    if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return null;
    if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|example)$/.test(h)) return null;
    return u;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };
const decode = (s: string) =>
  s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? m);

/** Visible text of an HTML page, plus its links (href + text). */
export function readHtml(html: string, base: URL): { text: string; links: { url: URL; label: string }[] } {
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ');
  const links: { url: URL; label: string }[] = [];
  for (const m of body.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      links.push({ url: new URL(decode(m[1]), base), label: decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() });
    } catch {
      /* bad href */
    }
  }
  const text = decode(body.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  return { text, links };
}

async function fetchPage(raw: string): Promise<{ url: URL; text: string; links: { url: URL; label: string }[] } | null> {
  let url = safeUrl(raw);
  for (let hop = 0; url && hop < 4; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'User-Agent': 'RentReadyBot/1.0 (+https://werentreadygo.com/privacy)', Accept: 'text/html' } });
      if (r.status >= 300 && r.status < 400) {
        url = safeUrl(new URL(r.headers.get('Location') || '', url).href); // every redirect is re-checked
        continue;
      }
      if (!r.ok || !/text\/html|application\/xhtml/.test(r.headers.get('Content-Type') || '')) return null;
      const html = (await r.text()).slice(0, MAX_BYTES);
      return { url, ...readHtml(html, url) };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

const LIKELY = /(qualif|criteria|screen|apply|application|eligib|requirement|second[\s-]?chance|faq|resident[\s-]?selection|leasing|lease|floor[\s-]?plan|pricing|rent)/i;

/** Home page + up to two same-site pages most likely to state screening criteria or rent. */
export async function readProperty(website: string) {
  const home = await fetchPage(website);
  if (!home) return null;
  const seen = new Set([home.url.href.replace(/\/$/, '')]);
  const picks = home.links
    .filter((l) => l.url.hostname === home.url.hostname && (LIKELY.test(l.label) || LIKELY.test(l.url.pathname)))
    .sort((a, b) => Number(/qualif|criteria|screen|eligib|second/i.test(b.label + b.url.pathname)) - Number(/qualif|criteria|screen|eligib|second/i.test(a.label + a.url.pathname)))
    .map((l) => l.url.href.replace(/#.*$/, ''))
    .filter((h) => (seen.has(h.replace(/\/$/, '')) ? false : (seen.add(h.replace(/\/$/, '')), true)))
    .slice(0, 2);
  const more = (await Promise.all(picks.map(fetchPage))).filter((p): p is NonNullable<typeof p> => !!p);
  return [home, ...more].map((p) => ({ url: p.url.href, text: p.text.slice(0, PAGE_CHARS) }));
}

// ---------------------------------------------------------------- OpenAI
export interface Verdict { second_chance: 'yes' | 'no' | 'unclear'; evidence_quote: string; evidence_page: number; rent_min: number | null; rent_max: number | null; rent_quote: string }

const SYSTEM = `You check apartment property websites for a renter-help service. Be strict and literal.
Answer "yes" ONLY if a page explicitly says the property accepts or will consider applicants with one of: past evictions, broken leases, bad/low/no credit, collections, bankruptcy, or criminal history — or that it has a "second chance" leasing program.
NOT "yes": fair-housing statements, "credit check required", income requirements, "all applicants welcome", cosigner/guarantor options alone, or anything implied rather than stated.
evidence_quote: copy ONE sentence from the page EXACTLY, character for character, that proves "yes". Empty string otherwise. evidence_page: the PAGE number it came from.
rent_min / rent_max: monthly rent in dollars ONLY if the pages state it (e.g. "Starting at $1,250", "$1,250 - $1,600"). Ignore fees and deposits. rent_quote: the exact text containing those numbers. Use null and "" when not stated.`;

const SCHEMA = {
  name: 'second_chance_check', strict: true,
  schema: {
    type: 'object', additionalProperties: false,
    required: ['second_chance', 'evidence_quote', 'evidence_page', 'rent_min', 'rent_max', 'rent_quote'],
    properties: {
      second_chance: { type: 'string', enum: ['yes', 'no', 'unclear'] },
      evidence_quote: { type: 'string' }, evidence_page: { type: 'integer' },
      rent_min: { type: ['number', 'null'] }, rent_max: { type: ['number', 'null'] }, rent_quote: { type: 'string' },
    },
  },
};

export const model = (env: Env) => env.OPENAI_MODEL || 'gpt-4.1-mini';

export async function askOpenAI(env: Env, name: string, pages: { url: string; text: string }[]): Promise<Verdict> {
  const user = `Property: ${name}\n\n` + pages.map((p, i) => `=== PAGE ${i} (${p.url}) ===\n${p.text}`).join('\n\n');
  const call = (format: unknown) =>
    fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model(env), messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }], response_format: format }),
    });
  let r = await call({ type: 'json_schema', json_schema: SCHEMA });
  if (r.status === 400) r = await call({ type: 'json_object' }); // models without structured outputs
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = (await r.json()) as { choices: { message: { content: string } }[] };
  const v = JSON.parse(d.choices[0].message.content) as Partial<Verdict>;
  return {
    second_chance: v.second_chance === 'yes' || v.second_chance === 'no' ? v.second_chance : 'unclear',
    evidence_quote: String(v.evidence_quote || ''), evidence_page: Number(v.evidence_page) || 0,
    rent_min: typeof v.rent_min === 'number' ? v.rent_min : null, rent_max: typeof v.rent_max === 'number' ? v.rent_max : null,
    rent_quote: String(v.rent_quote || ''),
  };
}

// ---------------------------------------------------------------- verification (never trust the model alone)
const norm = (s: string) => s.toLowerCase().replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();

/** The quote must appear on the page word-for-word and be a real sentence about screening. */
export function quoteOnPage(quote: string, page: string) {
  const q = norm(quote).replace(/^["'\s]+|["'\s]+$/g, '');
  return q.length >= 20 && q.length <= 600 && norm(page).includes(q);
}

/** Rent is kept only if its quote is on a page and contains the numbers. */
export function checkedRent(v: Verdict, pages: { text: string }[]): { min: number; max: number | null } | null {
  if (v.rent_min == null || !v.rent_quote || !pages.some((p) => quoteOnPage(v.rent_quote, p.text) || norm(p.text).includes(norm(v.rent_quote)))) return null;
  const digits = v.rent_quote.replace(/[,\s]/g, '');
  const has = (n: number) => digits.includes(String(Math.round(n)));
  const ok = (n: number) => n >= 300 && n <= 20000;
  if (!ok(v.rent_min) || !has(v.rent_min)) return null;
  const max = v.rent_max != null && ok(v.rent_max) && v.rent_max > v.rent_min && has(v.rent_max) ? v.rent_max : null;
  return { min: v.rent_min, max };
}

// ---------------------------------------------------------------- Google: an area's apartment communities
export interface GPlace { id: string; name: string; address: string; phone: string | null; website: string | null; photo: string | null }

export async function areaPlaces(env: Env, city: string, state: string): Promise<GPlace[]> {
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'X-Goog-Api-Key': env.GOOGLE_MAPS_API_KEY!, 'Content-Type': 'application/json',
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.photos',
    },
    body: JSON.stringify({ textQuery: `apartment complexes in ${city}, ${state}`, pageSize: 20, languageCode: 'en' }),
  });
  if (!r.ok) throw new Error(`Google ${r.status}`);
  const d = (await r.json()) as { places?: { id: string; displayName?: { text: string }; formattedAddress?: string; nationalPhoneNumber?: string; websiteUri?: string; photos?: { name: string }[] }[] };
  return (d.places || []).map((p) => ({
    id: p.id, name: p.displayName?.text || 'Apartment community', address: p.formattedAddress || '',
    phone: p.nationalPhoneNumber || null, website: p.websiteUri || null, photo: p.photos?.[0]?.name || null,
  }));
}

// ---------------------------------------------------------------- queue
export async function scansToday(env: Env) {
  const since = new Date().toISOString().slice(0, 10);
  return (await env.DB!.prepare("SELECT COUNT(*) AS n FROM rr_place_scans WHERE scanned_at >= ? AND result <> 'no_website'").bind(since).first<{ n: number }>())?.n ?? 0;
}

/** Queues an area's communities (once a day per area; skips ones checked within the TTL). */
export async function enqueueArea(env: Env, city: string, state: string): Promise<{ status: 'queued' | 'recent'; queued: number }> {
  const DB = env.DB!;
  const key = areaKey(city, state);
  const last = await DB.prepare('SELECT requested_at FROM rr_area_scans WHERE area_key = ?').bind(key).first<{ requested_at: string }>();
  if (last && Date.now() - Date.parse(last.requested_at) < 86400000) return { status: 'recent', queued: 0 };
  const places = await areaPlaces(env, city, state);
  const fresh = new Date(Date.now() - ttlDays(env) * 86400000).toISOString();
  const now = new Date().toISOString();
  let queued = 0;
  for (const p of places) {
    const done = await DB.prepare('SELECT scanned_at FROM rr_place_scans WHERE place_id = ? AND scanned_at >= ?').bind(p.id, fresh).first();
    if (done) continue;
    const r = (await DB.prepare('INSERT INTO rr_scan_queue (place_id, city, state, payload, enqueued_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
      .bind(p.id, city.trim(), state.trim().toUpperCase(), JSON.stringify(p), now).run()) as { meta?: { changes?: number } };
    if (r?.meta?.changes !== 0) queued++;
  }
  await DB.prepare('INSERT INTO rr_area_scans (area_key, requested_at, places) VALUES (?, ?, ?) ON CONFLICT(area_key) DO UPDATE SET requested_at = excluded.requested_at, places = excluded.places')
    .bind(key, now, places.length).run();
  return { status: 'queued', queued };
}

/** Checks one community and records the result; lists it only on a verified quote. */
export async function scanPlace(env: Env, origin: string, city: string, state: string, p: GPlace) {
  const DB = env.DB!;
  const now = new Date().toISOString();
  const record = (result: string, extra: { quote?: string | null; url?: string | null; rent?: { min: number; max: number | null } | null } = {}) =>
    DB.prepare(
      `INSERT INTO rr_place_scans (place_id, city, state, name, website, result, evidence_quote, evidence_url, rent_min_cents, rent_max_cents, model, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(place_id) DO UPDATE SET result = excluded.result, evidence_quote = excluded.evidence_quote, evidence_url = excluded.evidence_url,
         rent_min_cents = excluded.rent_min_cents, rent_max_cents = excluded.rent_max_cents, model = excluded.model, scanned_at = excluded.scanned_at, website = excluded.website, name = excluded.name`,
    ).bind(p.id, city, state, p.name, p.website, result, extra.quote ?? null, extra.url ?? null,
      extra.rent ? Math.round(extra.rent.min * 100) : null, extra.rent?.max ? Math.round(extra.rent.max * 100) : null, model(env), now).run();
  // A previously listed property whose policy can no longer be found is taken down (never left as "second-chance").
  const takeDown = () => DB.prepare("UPDATE rr_listings SET classification = 'unavailable', updated_at = ? WHERE listing_id = ? AND source_name = ?").bind(now, `gp_${p.id}`, AUTO_SOURCE).run();

  if (!safeUrl(p.website)) {
    await record('no_website');
    await takeDown();
    return 'no_website';
  }
  const pages = await readProperty(p.website!);
  if (!pages?.length) {
    await record('unreachable');
    return 'unreachable';
  }
  const v = await askOpenAI(env, p.name, pages);
  const evidence = pages[v.evidence_page] && quoteOnPage(v.evidence_quote, pages[v.evidence_page].text) ? pages[v.evidence_page]
    : v.second_chance === 'yes' ? pages.find((pg) => quoteOnPage(v.evidence_quote, pg.text)) : undefined;
  const rent = checkedRent(v, pages);
  if (v.second_chance !== 'yes' || !evidence) {
    await record(v.second_chance === 'yes' ? 'unclear' : v.second_chance, { rent });
    await takeDown();
    return v.second_chance === 'yes' ? 'unverified_quote' : v.second_chance;
  }
  const quote = v.evidence_quote.trim().replace(/^["']|["']$/g, '');
  await record('second_chance', { quote, url: evidence.url, rent });
  await DB.prepare(
    `INSERT INTO rr_listings (listing_id, classification, name, address, city, state, rent_cents, rent_max_cents, beds, baths, description, phone, website, photo_url, screening_note, source_name, source_url, verified_at, created_at, updated_at)
     VALUES (?, 'verified_second_chance', ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(listing_id) DO UPDATE SET classification = 'verified_second_chance', name = excluded.name, address = excluded.address, rent_cents = excluded.rent_cents,
       rent_max_cents = excluded.rent_max_cents, phone = excluded.phone, website = excluded.website, photo_url = excluded.photo_url, screening_note = excluded.screening_note,
       source_url = excluded.source_url, verified_at = excluded.verified_at, updated_at = excluded.updated_at
     WHERE rr_listings.source_name = excluded.source_name`,
  ).bind(`gp_${p.id}`, p.name, p.address.replace(/, USA$/, ''), city, state, rent ? Math.round(rent.min * 100) : null, rent?.max ? Math.round(rent.max * 100) : null,
    p.phone, p.website, p.photo ? `${origin}/finder/api/photos?name=${encodeURIComponent(p.photo)}&maxWidthPx=900` : null,
    `“${quote}”`, AUTO_SOURCE, evidence.url, now.slice(0, 10), now, now).run();
  return 'second_chance';
}

/**
 * Works through the queue a few at a time (fits a 30-second scheduled function), within the daily cap. When the queue
 * is empty it re-checks automatically listed properties older than the TTL, so listings never go stale.
 */
export async function processQueue(env: Env, origin: string, batch = 3) {
  const DB = env.DB!;
  if (!env.OPENAI_API_KEY || !env.GOOGLE_MAPS_API_KEY) return { skipped: 'not configured' };
  const room = dailyLimit(env) - (await scansToday(env));
  if (room <= 0) return { skipped: 'daily limit reached' };
  let jobs = (await DB.prepare('SELECT * FROM rr_scan_queue ORDER BY enqueued_at LIMIT ?').bind(Math.min(batch, room))
    .all<{ place_id: string; city: string; state: string; payload: string; attempts: number }>()).results;
  if (!jobs.length) {
    const stale = new Date(Date.now() - ttlDays(env) * 86400000).toISOString();
    const due = (await DB.prepare(`SELECT s.place_id, s.city, s.state, s.name, s.website FROM rr_place_scans s JOIN rr_listings l ON l.listing_id = 'gp_' || s.place_id
       WHERE l.classification = 'verified_second_chance' AND l.source_name = ? AND s.scanned_at < ? LIMIT ?`).bind(AUTO_SOURCE, stale, Math.min(batch, room))
      .all<{ place_id: string; city: string; state: string; name: string; website: string | null }>()).results;
    const now = new Date().toISOString();
    for (const d of due) {
      const l = await DB.prepare('SELECT address, phone, photo_url FROM rr_listings WHERE listing_id = ?').bind(`gp_${d.place_id}`).first<{ address: string | null; phone: string | null; photo_url: string | null }>();
      const photo = l?.photo_url ? new URL(l.photo_url).searchParams.get('name') : null;
      const payload: GPlace = { id: d.place_id, name: d.name, address: l?.address || '', phone: l?.phone || null, website: d.website, photo };
      await DB.prepare('INSERT INTO rr_scan_queue (place_id, city, state, payload, enqueued_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING').bind(d.place_id, d.city, d.state, JSON.stringify(payload), now).run();
    }
    jobs = (await DB.prepare('SELECT * FROM rr_scan_queue ORDER BY enqueued_at LIMIT ?').bind(Math.min(batch, room)).all<{ place_id: string; city: string; state: string; payload: string; attempts: number }>()).results;
  }
  const results = await Promise.all(jobs.map(async (j) => {
    await DB.prepare('UPDATE rr_scan_queue SET attempts = attempts + 1 WHERE place_id = ?').bind(j.place_id).run();
    try {
      const r = await scanPlace(env, origin, j.city, j.state, JSON.parse(j.payload) as GPlace);
      await DB.prepare('DELETE FROM rr_scan_queue WHERE place_id = ?').bind(j.place_id).run();
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 200) : 'error';
      if (j.attempts + 1 >= 2) await DB.prepare('DELETE FROM rr_scan_queue WHERE place_id = ?').bind(j.place_id).run();
      else await DB.prepare('UPDATE rr_scan_queue SET last_error = ? WHERE place_id = ?').bind(msg, j.place_id).run();
      console.error('scan failed', j.place_id, msg);
      return 'error';
    }
  }));
  return { processed: jobs.length, results };
}

/** Progress for an area, shown while its websites are being checked. */
export async function areaStatus(env: Env, city: string, state: string) {
  const DB = env.DB!;
  const one = async (q: string) => (await DB.prepare(q).bind(city.trim(), state.trim()).first<{ n: number }>())?.n ?? 0;
  const [pending, checked, found] = await Promise.all([
    one('SELECT COUNT(*) AS n FROM rr_scan_queue WHERE LOWER(city) = LOWER(?) AND UPPER(state) = UPPER(?)'),
    one("SELECT COUNT(*) AS n FROM rr_place_scans WHERE LOWER(city) = LOWER(?) AND UPPER(state) = UPPER(?) AND result <> 'no_website'"),
    one("SELECT COUNT(*) AS n FROM rr_place_scans WHERE LOWER(city) = LOWER(?) AND UPPER(state) = UPPER(?) AND result = 'second_chance'"),
  ]);
  return { pending, checked, found };
}
