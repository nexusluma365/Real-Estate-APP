const {
  getPropertyVerification,
  savePropertyVerification,
} = require('./store');

const VERIFICATION_VERSION = 'screening-v1';
const DEFAULT_TTL_DAYS = 90;
const MAX_SOURCE_CHARS = 12000;
const VALID_STATUSES = new Set(['verified_second_chance', 'flexible_screening', 'unverified', 'verification_pending', 'verification_error']);

function nowIso() {
  return new Date().toISOString();
}

function addDaysIso(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isCurrent(record) {
  if (!record || record.verificationVersion !== VERIFICATION_VERSION) return false;
  if (!record.verificationExpiresAt) return true;
  return Date.parse(record.verificationExpiresAt) > Date.now();
}

function sourceDomain(url) {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch (_err) {
    return '';
  }
}

function officialDomainsFor(property) {
  return [sourceDomain(property && property.website)].filter(Boolean);
}

function isFirstPartySource(source, property) {
  if (source && source.firstParty === true) return true;
  const domain = sourceDomain(source && source.url);
  if (!domain) return false;
  return officialDomainsFor(property).some((official) => domain === official || domain.endsWith(`.${official}`));
}

function cleanText(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortEvidence(value) {
  const text = cleanText(value);
  return text.length > 360 ? `${text.slice(0, 357)}...` : text;
}

function excerptAround(text, pattern) {
  const value = cleanText(text);
  const match = value.match(pattern);
  if (!match || match.index === undefined) return shortEvidence(value);
  const start = Math.max(0, match.index - 130);
  const end = Math.min(value.length, match.index + match[0].length + 130);
  return shortEvidence(value.slice(start, end));
}

function classifySources(sources, property = {}) {
  const firstParty = (sources || []).filter((source) => isFirstPartySource(source, property));
  if (!firstParty.length) {
    return {
      status: 'unverified',
      evidence_summary: 'No first-party screening-policy evidence was available.',
      source_url: null,
      reason: 'Only missing or non-official sources were available.',
      confidence: 0,
      requires_human_review: false,
    };
  }

  const verifiedPattern = /\b(second[-\s]?chance|second chance program|second-chance program)\b|(?:eviction|broken lease|adverse rental history)[^.]{0,120}\b(accepted|considered|may qualify|eligible|approval)\b/i;
  const flexiblePattern = /\b(conditional approval|conditionally approved|additional deposit|higher deposit|guarantor|co[-\s]?signer|case[-\s]?by[-\s]?case|individual basis|flexible screening|credit history may be considered)\b/i;

  for (const source of firstParty) {
    const text = cleanText(source.content || source.text || source.excerpt || '');
    if (verifiedPattern.test(text)) {
      return {
        status: 'verified_second_chance',
        evidence_summary: excerptAround(text, verifiedPattern),
        source_url: source.url || null,
        reason: 'First-party source explicitly supports a second-chance-like rental screening program.',
        confidence: 0.92,
        requires_human_review: false,
      };
    }
  }

  for (const source of firstParty) {
    const text = cleanText(source.content || source.text || source.excerpt || '');
    if (flexiblePattern.test(text)) {
      return {
        status: 'flexible_screening',
        evidence_summary: excerptAround(text, flexiblePattern),
        source_url: source.url || null,
        reason: 'First-party source supports conditional or flexible screening, but not enough to claim verified second-chance.',
        confidence: 0.72,
        requires_human_review: false,
      };
    }
  }

  return {
    status: 'unverified',
    evidence_summary: 'First-party source did not provide enough screening-policy evidence.',
    source_url: firstParty[0].url || null,
    reason: 'Evidence was missing, ambiguous, or insufficient.',
    confidence: 0.2,
    requires_human_review: false,
  };
}

function normalizeClassifierResult(result) {
  const status = VALID_STATUSES.has(result && result.status) ? result.status : 'unverified';
  return {
    screeningStatus: status,
    verificationSourceUrl: result && result.source_url ? String(result.source_url).slice(0, 1000) : null,
    verificationSourceDomain: result && result.source_url ? sourceDomain(result.source_url) : null,
    verificationEvidence: shortEvidence(result && result.evidence_summary),
    verificationMethod: 'first_party_policy_classifier',
    verifiedAt: nowIso(),
    verificationExpiresAt: addDaysIso(Number(process.env.RENTREADY_VERIFICATION_TTL_DAYS || DEFAULT_TTL_DAYS)),
    verificationConfidence: Math.max(0, Math.min(1, Number(result && result.confidence) || 0)),
    verificationVersion: VERIFICATION_VERSION,
    reason: result && result.reason ? String(result.reason).slice(0, 500) : '',
    requiresHumanReview: !!(result && result.requires_human_review),
  };
}

function verificationForResponse(verification) {
  const status = verification && VALID_STATUSES.has(verification.screeningStatus)
    ? verification.screeningStatus
    : 'unverified';
  return {
    screeningStatus: status === 'verification_pending' || status === 'verification_error' ? 'unverified' : status,
    verificationSourceDomain: verification && verification.verificationSourceDomain ? verification.verificationSourceDomain : null,
    verificationEvidence: verification && verification.verificationEvidence ? verification.verificationEvidence : null,
    verifiedAt: verification && verification.verifiedAt ? verification.verifiedAt : null,
  };
}

function researchQueries(property) {
  const name = property && property.name ? `"${property.name}"` : '';
  const management = property && property.managementCompany ? `"${property.managementCompany}"` : '';
  return [
    `${name} "second chance"`,
    `${name} "rental criteria"`,
    `${name} "resident selection criteria"`,
    `${name} eviction`,
    `${name} "broken lease"`,
    `${name} "credit requirements"`,
    `${name} "conditional approval"`,
    management ? `${management} "rental criteria"` : '',
    management ? `${management} "resident selection criteria"` : '',
  ].filter((query) => query.trim().replace(/"/g, ''));
}

async function fetchOfficialWebsite(property) {
  const website = property && property.website ? String(property.website) : '';
  if (!/^https?:\/\//i.test(website)) return [];
  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), Number(process.env.RENTREADY_RESEARCH_TIMEOUT_MS || 5000));
    const resp = await fetch(website, {
      method: 'GET',
      headers: { Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' },
      signal: controller.signal,
    });
    if (!resp.ok) return [];
    const contentType = resp.headers && resp.headers.get ? resp.headers.get('content-type') || '' : '';
    if (contentType && !/text\/html|text\/plain|application\/xhtml/i.test(contentType)) return [];
    const text = (await resp.text()).slice(0, MAX_SOURCE_CHARS);
    return [{ url: website, content: text, firstParty: true }];
  } catch (err) {
    console.warn('screening verification official fetch failed', {
      propertyId: property && property.propertyId,
      domain: sourceDomain(website),
      message: err.message || String(err),
    });
    return [];
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchResearchProvider(property) {
  const url = String(process.env.RENTREADY_RESEARCH_PROVIDER_URL || '').trim();
  if (!url) return [];
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.RENTREADY_RESEARCH_PROVIDER_KEY
          ? { Authorization: `Bearer ${process.env.RENTREADY_RESEARCH_PROVIDER_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        property: {
          propertyId: property.propertyId,
          name: property.name,
          address: property.address,
          website: property.website,
        },
        officialDomains: officialDomainsFor(property),
        queries: researchQueries(property),
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !Array.isArray(data.sources)) return [];
    return data.sources.map((source) => ({
      url: source.url || '',
      content: String(source.content || source.text || source.excerpt || '').slice(0, MAX_SOURCE_CHARS),
      firstParty: source.firstParty === true,
    }));
  } catch (err) {
    console.warn('screening verification provider failed', {
      propertyId: property && property.propertyId,
      message: err.message || String(err),
    });
    return [];
  }
}

async function runVerification(property) {
  const sources = [
    ...(await fetchResearchProvider(property)),
    ...(await fetchOfficialWebsite(property)),
  ];
  const result = classifySources(sources, property);
  return normalizeClassifierResult(result);
}

async function getOrVerifyProperty(property) {
  const propertyId = property && property.propertyId;
  if (!propertyId) return normalizeClassifierResult({ status: 'unverified', evidence_summary: 'Missing property ID.' });
  const cached = await getPropertyVerification(propertyId).catch((err) => {
    console.warn('screening verification cache read failed', { propertyId, message: err.message || String(err) });
    return null;
  });
  if (isCurrent(cached)) {
    console.log('screening verification cache hit', { propertyId, status: cached.screeningStatus });
    return cached;
  }
  console.log('screening verification cache miss', { propertyId, expired: !!cached });
  let verification;
  try {
    verification = await runVerification(property);
  } catch (err) {
    console.error('screening verification classifier error', { propertyId, message: err.message || String(err) });
    verification = normalizeClassifierResult({
      status: 'unverified',
      evidence_summary: 'Verification failed safely.',
      reason: 'Classifier or research provider failed.',
      confidence: 0,
    });
  }
  await savePropertyVerification(propertyId, verification).catch((err) => {
    console.warn('screening verification cache write failed', { propertyId, message: err.message || String(err) });
  });
  console.log('screening verification final status', {
    propertyId,
    status: verification.screeningStatus,
    sourceDomain: verification.verificationSourceDomain || null,
  });
  return verification;
}

async function attachScreeningVerifications(properties, limit = 8) {
  const out = [];
  for (const property of properties || []) {
    if (!property || !property.propertyId) continue;
    const shouldVerify = out.length < limit;
    const verification = shouldVerify
      ? await getOrVerifyProperty(property)
      : normalizeClassifierResult({ status: 'unverified', evidence_summary: 'Verification not attempted for lower-ranked candidate.' });
    out.push({
      ...property,
      screeningVerification: verificationForResponse(verification),
    });
  }
  return prioritizeVerified(out);
}

function statusWeight(property) {
  const status = property && property.screeningVerification && property.screeningVerification.screeningStatus;
  if (status === 'verified_second_chance') return 2;
  if (status === 'flexible_screening') return 1;
  return 0;
}

function prioritizeVerified(properties) {
  return (properties || [])
    .map((property, index) => ({ property, index }))
    .sort((a, b) => {
      const diff = statusWeight(b.property) - statusWeight(a.property);
      return diff || a.index - b.index;
    })
    .map((entry) => entry.property);
}

module.exports = {
  VERIFICATION_VERSION,
  attachScreeningVerifications,
  classifySources,
  researchQueries,
  verificationForResponse,
};
