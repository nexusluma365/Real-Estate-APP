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
  const placeId = String(q.placeId || placeIdFromPhotoName(q.photoName)).trim();
  let photoName = String(q.photoName || '').trim();
  let attemptedFreshLookup = false;
  logRequest(placeId, photoName, attemptedFreshLookup);

  let image = photoName ? await fetchPlacePhoto(photoName, key, placeId) : { ok: false, status: 0 };
  if (image.ok) return imageResponse(image, placeId);

  if (placeId) {
    attemptedFreshLookup = true;
    logRequest(placeId, photoName, attemptedFreshLookup);
    photoName = await fetchFreshPlacePhoto(placeId, key);
    if (photoName) {
      image = await fetchPlacePhoto(photoName, key, placeId);
      if (image.ok) return imageResponse(image, placeId);
    }
  }

  return noPhotoResponse();
};

function googlePlacesApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
}

async function fetchPlacePhoto(photoName, key, placeId) {
  const safeName = String(photoName || '').replace(/^\/+/, '');
  if (!safeName.startsWith('places/')) return { ok: false, status: 400 };
  const imageUrl = new URL(`https://places.googleapis.com/v1/${safeName}/media`);
  imageUrl.searchParams.set('maxWidthPx', '1200');
  imageUrl.searchParams.set('maxHeightPx', '800');
  try {
    const resp = await fetch(imageUrl, {
      headers: { 'X-Goog-Api-Key': key },
      redirect: 'follow',
    });
    const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
    console.log('google-place-image media metadata', { placeId, status: resp.status, contentType });
    if (!resp.ok) {
      await logGoogleError('google-place-image Google error', placeId, resp);
      return { ok: false, status: resp.status };
    }
    if (contentType.startsWith('image/')) {
      return { ok: true, contentType, buffer: Buffer.from(await resp.arrayBuffer()) };
    }
    if (contentType.includes('application/json')) {
      const data = await resp.json().catch(() => ({}));
      const photoUri = typeof data.photoUri === 'string' ? data.photoUri : '';
      console.log('google-place-image photoUri received', { placeId, hasPhotoUri: !!photoUri });
      if (!photoUri) {
        console.warn('google-place-image Google error', { placeId, status: resp.status, errorMessage: 'Google Place Photo returned JSON without photoUri' });
        return { ok: false, status: resp.status };
      }
      return await fetchPhotoUri(photoUri, placeId);
    }
    console.warn('google-place-image Google error', { placeId, status: resp.status, errorMessage: `Expected Google property image but received ${contentType || 'unknown content type'}` });
    return { ok: false, status: resp.status };
  } catch (err) {
    console.warn('google-place-image Google error', { placeId, status: 'FETCH_ERROR', errorMessage: err.message || String(err) });
    return { ok: false, status: 0 };
  }
}

async function fetchPhotoUri(photoUri, placeId) {
  try {
    const resp = await fetch(photoUri, { redirect: 'follow' });
    const contentType = String(resp.headers.get('content-type') || '').toLowerCase();
    if (!resp.ok) {
      await logGoogleError('google-place-image Google error', placeId, resp);
      return { ok: false, status: resp.status };
    }
    if (!contentType.startsWith('image/')) {
      console.warn('google-place-image Google error', { placeId, status: resp.status, errorMessage: `Expected Google property image but received ${contentType || 'unknown content type'}` });
      return { ok: false, status: resp.status };
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    console.log('google-place-image final image', { placeId, status: resp.status, contentType, bytes: buffer.length });
    return { ok: true, contentType, buffer };
  } catch (err) {
    console.warn('google-place-image Google error', { placeId, status: 'FETCH_ERROR', errorMessage: err.message || String(err) });
    return { ok: false, status: 0 };
  }
}

async function fetchFreshPlacePhoto(placeId, key) {
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  try {
    const resp = await fetch(url, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'photos' },
    });
    const contentType = resp.headers.get('content-type') || '';
    console.log('google-place-image response', { placeId, status: resp.status, contentType });
    if (!resp.ok) {
      await logGoogleError('google-place-image Google error', placeId, resp);
      return '';
    }
    const data = await resp.json().catch(() => ({}));
    const photos = Array.isArray(data.photos) ? data.photos : [];
    const fresh = photos.find((photo) => photo && typeof photo.name === 'string' && photo.name.startsWith('places/'));
    return fresh ? fresh.name : '';
  } catch (err) {
    console.warn('google-place-image Google error', { placeId, status: 'FETCH_ERROR', errorMessage: err.message || String(err) });
    return '';
  }
}

function imageResponse(image, placeId) {
  console.log('google-place-image final image', { placeId, status: 200, contentType: image.contentType, bytes: image.buffer.length });
  return {
    statusCode: 200,
    headers: { 'Content-Type': image.contentType, 'Cache-Control': 'public, max-age=86400' },
    isBase64Encoded: true,
    body: image.buffer.toString('base64'),
  };
}

function noPhotoResponse() {
  return { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };
}

function logRequest(placeId, photoName, attemptedFreshLookup) {
  console.log('google-place-image request', {
    placeId,
    hasPhotoName: !!photoName,
    photoNamePrefix: photoName ? String(photoName).slice(0, 48) : '',
    attemptedFreshLookup,
  });
}

async function logGoogleError(label, placeId, resp) {
  let errorMessage = '';
  try {
    const body = await resp.text();
    const parsed = JSON.parse(body);
    errorMessage = parsed.error?.message || parsed.error?.status || body.slice(0, 240);
  } catch (_err) {
    errorMessage = 'Unable to read Google error response.';
  }
  console.warn(label, { placeId, status: resp.status, errorMessage });
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
