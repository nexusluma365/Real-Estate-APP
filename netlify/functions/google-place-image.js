// GET /.netlify/functions/google-place-image?photoName=places/.../photos/...
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
    const resp = await fetch(url.url, { headers: url.headers, redirect: 'follow' });
    if (!resp.ok) {
      console.warn('google-place-image fetch failed', {
        placeId: q.placeId || placeIdFromPhotoName(q.photoName),
        hasPhotoReference: !!q.photoName,
        status: resp.status,
      });
      return text(resp.status, 'Google image unavailable.');
    }
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
    console.warn('google-place-image fetch error', {
      placeId: q.placeId || placeIdFromPhotoName(q.photoName),
      hasPhotoReference: !!q.photoName,
      status: 'FETCH_ERROR',
      message: err.message || String(err),
    });
    return text(502, 'Google image unavailable.');
  }
};

function googlePlacesApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
}

function googleImageUrl(q, key) {
  const kind = String(q.kind || '').toLowerCase();
  if (q.photoName) {
    const safeName = String(q.photoName).replace(/^\/+/, '');
    if (!safeName.startsWith('places/')) return '';
    const imageUrl = new URL(`https://places.googleapis.com/v1/${safeName}/media`);
    imageUrl.searchParams.set('maxWidthPx', '1200');
    imageUrl.searchParams.set('maxHeightPx', '800');
    return { url: imageUrl.toString(), headers: { 'X-Goog-Api-Key': key } };
  }
  return '';
}

function placeIdFromPhotoName(name) {
  const match = String(name || '').match(/^places\/([^/]+)\/photos\//);
  return match ? match[1] : '';
}

function text(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body,
  };
}
