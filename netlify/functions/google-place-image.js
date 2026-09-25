// GET /.netlify/functions/google-place-image?kind=photo&ref=...
// GET /.netlify/functions/google-place-image?kind=new-photo&name=places/.../photos/...
// GET /.netlify/functions/google-place-image?kind=streetview&location=...
//
// Proxies Google-hosted listing imagery through the server so the browser
// does not need direct access to the Google API key.

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const key = googlePlacesApiKey();
  if (!key) return text(503, 'Google imagery is not configured.');

  const q = event.queryStringParameters || {};
  const url = googleImageUrl(q, key);
  if (!url) return text(400, 'Missing image parameters.');

  try {
    const resp = await fetch(url, { redirect: 'follow' });
    if (!resp.ok) return text(resp.status, 'Google image unavailable.');
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await resp.arrayBuffer());
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
      isBase64Encoded: true,
      body: buffer.toString('base64'),
    };
  } catch (err) {
    console.error('google-place-image error', err);
    return text(502, 'Google image unavailable.');
  }
};

function googlePlacesApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
}

function googleImageUrl(q, key) {
  const kind = String(q.kind || '').toLowerCase();
  if (kind === 'photo' && q.ref) {
    const url = new URL('https://maps.googleapis.com/maps/api/place/photo');
    url.searchParams.set('maxwidth', '900');
    url.searchParams.set('photo_reference', q.ref);
    url.searchParams.set('key', key);
    return url.toString();
  }
  if (kind === 'new-photo' && q.name) {
    const safeName = String(q.name).replace(/^\/+/, '');
    if (!safeName.startsWith('places/')) return '';
    const url = new URL(`https://places.googleapis.com/v1/${safeName}/media`);
    url.searchParams.set('maxWidthPx', '900');
    url.searchParams.set('key', key);
    return url.toString();
  }
  if (kind === 'streetview' && q.location) {
    const url = new URL('https://maps.googleapis.com/maps/api/streetview');
    url.searchParams.set('size', '900x520');
    url.searchParams.set('source', 'outdoor');
    url.searchParams.set('location', q.location);
    url.searchParams.set('key', key);
    return url.toString();
  }
  return '';
}

function text(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body,
  };
}
