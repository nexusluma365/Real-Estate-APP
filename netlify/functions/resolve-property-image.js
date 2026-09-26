// POST /.netlify/functions/resolve-property-image
// Resolves verified real property images without relying on Google Place Photos.
const crypto = require('crypto');
const dns = require('dns/promises');
const { URL } = require('url');
const OpenAI = require('openai');
const { getPropertyImageCache, savePropertyImageCache } = require('./_lib/store');

const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MIN_IMAGE_BYTES = 2048;
const BAD_IMAGE_WORDS = /\b(logo|icon|favicon|sprite|avatar|marker|map|floor[-_ ]?plan|transparent|placeholder|tracking|pixel)\b/i;
const BAD_SOURCE_HOSTS = /\b(pinterest|facebook|instagram|tiktok|youtube|yelp|tripadvisor|zillow|redfin|realtor|apartments\.com|apartmentfinder|apartmentguide|forrent|rentcafe|google)\b/i;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function clean(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeUrl(value) {
  const raw = clean(value, 500);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_err) {
    return '';
  }
}

function hostnameOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch (_err) {
    return '';
  }
}

function baseDomain(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}

function domainsMatch(a, b) {
  if (!a || !b) return false;
  const left = baseDomain(a);
  const right = baseDomain(b);
  return left && right && left === right;
}

function normalizeText(value) {
  return clean(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseAddress(address) {
  const text = normalizeText(address);
  const streetNumber = (text.match(/\b\d{1,6}\b/) || [''])[0];
  const zip = (text.match(/\b\d{5}(?:\d{4})?\b/) || [''])[0];
  const state = (String(address || '').match(/\b[A-Z]{2}\b/) || [''])[0].toLowerCase();
  const commaParts = String(address || '').split(',').map((part) => normalizeText(part)).filter(Boolean);
  const city = commaParts.length >= 2 ? commaParts[commaParts.length - 2].split(' ').filter((part) => !/^\d+$/.test(part)).join(' ') : '';
  return { text, streetNumber, zip, state, city };
}

function containsNearName(pageText, name) {
  const source = normalizeText(pageText);
  const property = normalizeText(name);
  if (!source || !property) return false;
  if (source.includes(property)) return true;
  const terms = property.split(' ').filter((word) => word.length > 2);
  if (terms.length < 2) return false;
  const hits = terms.filter((word) => source.includes(word)).length;
  return hits / terms.length >= 0.75;
}

function containsAddress(pageText, address) {
  const source = normalizeText(pageText);
  const parsed = parseAddress(address);
  if (!source || !parsed.text) return false;
  if (source.includes(parsed.text)) return true;
  const streetWords = parsed.text.split(' ').filter((word) => word.length > 2);
  const streetHits = streetWords.filter((word) => source.includes(word)).length;
  const hasStreetNumber = parsed.streetNumber ? source.includes(parsed.streetNumber) : true;
  const hasZip = parsed.zip ? source.includes(parsed.zip) : true;
  const hasState = parsed.state ? source.includes(parsed.state) : true;
  const hasCity = parsed.city ? source.includes(parsed.city) : true;
  return hasStreetNumber && hasZip && hasState && hasCity && streetHits >= Math.min(3, streetWords.length);
}

function cacheKeyFor(input) {
  const stable = clean(input.propertyId, 180) || `${normalizeText(input.name)}|${normalizeText(input.address)}`;
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function cacheFresh(entry) {
  if (!entry || !entry.lastVerifiedAt) return false;
  const age = Date.now() - Date.parse(entry.lastVerifiedAt);
  if (!Number.isFinite(age) || age < 0) return false;
  if (entry.verificationStatus === 'verified') return age < POSITIVE_TTL_MS;
  if (entry.verificationStatus === 'not_found') return age < NEGATIVE_TTL_MS;
  return false;
}

function sanitizeInput(raw) {
  const name = clean(raw && raw.name, 180);
  const address = clean(raw && raw.address, 260);
  const propertyId = clean(raw && raw.propertyId, 180);
  const website = normalizeUrl(raw && raw.website);
  if (!name || (!address && !website && !propertyId)) {
    return { error: 'missing_property_identity' };
  }
  return { propertyId, name, address, website };
}

async function readJsonBody(event) {
  if (!event.body) return {};
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  return JSON.parse(text);
}

function privateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  return !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '0.0.0.0' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host === '::1' ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('169.254.');
}

async function assertPublicUrl(urlString) {
  const url = new URL(urlString);
  if (url.protocol !== 'https:') throw new Error('non_https_url');
  if (privateHostname(url.hostname)) throw new Error('private_url');
  try {
    const addresses = await dns.lookup(url.hostname, { all: true });
    if (addresses.some((entry) => privateHostname(entry.address))) throw new Error('private_url');
  } catch (err) {
    if (err.message === 'private_url') throw err;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSourceText(url) {
  await assertPublicUrl(url);
  const resp = await fetchWithTimeout(url, { method: 'GET', headers: { Accept: 'text/html,application/xhtml+xml' } });
  if (!resp.ok) return '';
  const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) return '';
  return (await resp.text()).slice(0, 250000);
}

async function validateImageUrl(imageUrl) {
  if (!imageUrl || BAD_IMAGE_WORDS.test(imageUrl)) return { ok: false, reason: 'rejected_image_url' };
  await assertPublicUrl(imageUrl);

  const head = await fetchWithTimeout(imageUrl, { method: 'HEAD' });
  let contentType = String(head.headers.get('content-type') || '').toLowerCase();
  let length = Number(head.headers.get('content-length') || 0);
  let resp = head;

  if (!head.ok || !contentType.startsWith('image/') || !length) {
    resp = await fetchWithTimeout(imageUrl, { method: 'GET', headers: { Accept: 'image/*' } });
    contentType = String(resp.headers.get('content-type') || '').toLowerCase();
    length = Number(resp.headers.get('content-length') || 0);
  }

  if (!resp.ok) return { ok: false, reason: `image_http_${resp.status}` };
  if (!contentType.startsWith('image/')) return { ok: false, reason: 'non_image_content_type' };
  if (contentType.includes('svg')) return { ok: false, reason: 'svg_rejected' };
  if (length && length > MAX_IMAGE_BYTES) return { ok: false, reason: 'oversized_image' };
  if (length && length < MIN_IMAGE_BYTES) return { ok: false, reason: 'tiny_image' };
  return { ok: true, contentType, bytes: length || null };
}

function parseOpenAIJson(response) {
  const direct = response && response.output_text;
  if (direct) return JSON.parse(direct);
  const output = Array.isArray(response && response.output) ? response.output : [];
  for (const item of output) {
    const parts = Array.isArray(item.content) ? item.content : [];
    for (const part of parts) {
      if (part && part.text) return JSON.parse(part.text);
    }
  }
  throw new Error('empty_openai_response');
}

async function searchWithOpenAI(input) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: 'openai_key_missing' };

  const client = new OpenAI({ apiKey });
  const officialDomain = hostnameOf(input.website);
  const query = officialDomain
    ? `site:${officialDomain} "${input.name}" "${input.address}" apartment photos`
    : `"${input.name}" "${input.address}" apartment official website photos`;

  console.log('PROPERTY IMAGE SEARCH', { propertyId: input.propertyId, name: input.name });
  const response = await client.responses.create({
    model: process.env.OPENAI_IMAGE_SEARCH_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    tools: [{ type: 'web_search_preview' }],
    input: [
      {
        role: 'system',
        content: [
          'Find one real image for the exact apartment community supplied by the user.',
          'Do not create or imagine images. Do not use stock photos, social media, Google Maps photos, Street View, logos, maps, floor plans, or unrelated listings.',
          'Prefer the official property website or property-management page. Return only JSON matching the schema.',
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          search: query,
          property: {
            propertyId: input.propertyId,
            name: input.name,
            address: input.address,
            officialWebsite: input.website,
            officialDomain,
          },
          requiredEvidence: 'The source page must identify this exact property by official domain, exact/near-exact name with matching address, or known management site.',
        }),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'property_image_candidate',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            match: { type: 'boolean' },
            confidence: { type: 'number' },
            imageUrl: { type: 'string' },
            sourcePageUrl: { type: 'string' },
            sourceType: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['match', 'confidence', 'imageUrl', 'sourcePageUrl', 'sourceType', 'reason'],
        },
      },
    },
  });

  return { ok: true, candidate: parseOpenAIJson(response) };
}

async function verifyCandidate(input, candidate) {
  if (!candidate || candidate.match !== true) return { ok: false, reason: 'no_candidate_match' };
  if (Number(candidate.confidence || 0) < 0.78) return { ok: false, reason: 'low_confidence' };

  const imageUrl = normalizeUrl(candidate.imageUrl);
  const sourcePageUrl = normalizeUrl(candidate.sourcePageUrl);
  if (!imageUrl || !sourcePageUrl) return { ok: false, reason: 'invalid_candidate_urls' };

  const sourceDomain = hostnameOf(sourcePageUrl);
  const officialDomain = hostnameOf(input.website);
  if (BAD_SOURCE_HOSTS.test(sourceDomain) && !domainsMatch(sourceDomain, officialDomain)) {
    return { ok: false, reason: 'untrusted_source_domain' };
  }

  const sourceText = await fetchSourceText(sourcePageUrl).catch(() => '');
  const officialMatch = domainsMatch(sourceDomain, officialDomain);
  const nameMatch = containsNearName(sourceText, input.name);
  const addressMatch = input.address ? containsAddress(sourceText, input.address) : false;

  if (!officialMatch && !(nameMatch && addressMatch)) {
    return { ok: false, reason: 'source_not_tied_to_exact_property' };
  }

  if (!officialMatch && BAD_SOURCE_HOSTS.test(sourceDomain)) {
    return { ok: false, reason: 'aggregator_source_rejected' };
  }

  const image = await validateImageUrl(imageUrl);
  if (!image.ok) return image;

  return {
    ok: true,
    imageUrl,
    sourcePageUrl,
    sourceDomain,
    sourceType: clean(candidate.sourceType, 80) || (officialMatch ? 'official_site' : 'authoritative_page'),
    verificationReason: clean(candidate.reason, 300) || 'Verified from exact property identity signals.',
  };
}

async function resolveImage(input) {
  const cacheKey = cacheKeyFor(input);
  const cached = await getPropertyImageCache(cacheKey);
  if (cacheFresh(cached)) {
    if (cached.verificationStatus === 'verified' && cached.imageUrl) {
      console.log('PROPERTY IMAGE CACHE HIT', { propertyId: input.propertyId, sourceDomain: cached.sourceDomain });
      return { ok: true, imageUrl: cached.imageUrl, sourcePageUrl: cached.sourcePageUrl, sourceDomain: cached.sourceDomain, cached: true };
    }
    console.log('PROPERTY IMAGE REJECTED', { propertyId: input.propertyId, reason: cached.verificationReason || 'negative_cache' });
    return { ok: false, reason: 'no_verified_property_image', cached: true };
  }

  try {
    const search = await searchWithOpenAI(input);
    if (!search.ok) {
      await saveNegative(cacheKey, input, search.reason);
      return { ok: false, reason: 'no_verified_property_image' };
    }

    const verified = await verifyCandidate(input, search.candidate);
    if (!verified.ok) {
      console.warn('PROPERTY IMAGE REJECTED', { propertyId: input.propertyId, reason: verified.reason });
      await saveNegative(cacheKey, input, verified.reason);
      return { ok: false, reason: 'no_verified_property_image' };
    }

    const saved = await savePropertyImageCache(cacheKey, {
      propertyId: input.propertyId,
      propertyName: input.name,
      propertyAddress: input.address,
      officialWebsite: input.website,
      imageUrl: verified.imageUrl,
      sourcePageUrl: verified.sourcePageUrl,
      sourceDomain: verified.sourceDomain,
      sourceType: verified.sourceType,
      verificationStatus: 'verified',
      verificationReason: verified.verificationReason,
      lastVerifiedAt: new Date().toISOString(),
    });
    console.log('PROPERTY IMAGE VERIFIED', { propertyId: input.propertyId, sourceDomain: saved.sourceDomain, sourceType: saved.sourceType });
    return { ok: true, imageUrl: saved.imageUrl, sourcePageUrl: saved.sourcePageUrl, sourceDomain: saved.sourceDomain, cached: false };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timeout' : clean(err && err.message, 180) || 'resolver_error';
    console.warn('PROPERTY IMAGE FAILED', { propertyId: input.propertyId, stage: 'resolve', reason });
    await saveNegative(cacheKey, input, reason).catch(() => {});
    return { ok: false, reason: 'no_verified_property_image' };
  }
}

async function saveNegative(cacheKey, input, reason) {
  return savePropertyImageCache(cacheKey, {
    propertyId: input.propertyId,
    propertyName: input.name,
    propertyAddress: input.address,
    officialWebsite: input.website,
    imageUrl: '',
    sourcePageUrl: '',
    sourceDomain: '',
    sourceType: '',
    verificationStatus: 'not_found',
    verificationReason: clean(reason, 300) || 'no_verified_property_image',
    lastVerifiedAt: new Date().toISOString(),
  });
}

async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { ok: false, reason: 'method_not_allowed' });

  let body;
  try {
    body = await readJsonBody(event);
  } catch (_err) {
    return json(400, { ok: false, reason: 'invalid_json' });
  }

  const input = sanitizeInput(body);
  if (input.error) return json(400, { ok: false, reason: input.error });

  const result = await resolveImage(input);
  if (!result.ok) return json(200, { ok: false, reason: result.reason || 'no_verified_property_image', cached: !!result.cached });
  return json(200, {
    ok: true,
    imageUrl: result.imageUrl,
    sourcePageUrl: result.sourcePageUrl,
    sourceDomain: result.sourceDomain,
    cached: !!result.cached,
  });
}

module.exports = {
  handler,
  _internals: {
    cacheKeyFor,
    sanitizeInput,
    verifyCandidate,
    validateImageUrl,
    privateHostname,
    parseOpenAIJson,
  },
};
