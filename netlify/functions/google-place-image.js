// GET /.netlify/functions/google-place-image?placeId=...
//
// Server-side proxy for Google Places (New) photos. The browser never receives
// the Google API key; it only receives a binary image response or a controlled
// no-photo response.

const PHOTO_MAX_WIDTH = '1200';
const PHOTO_MAX_HEIGHT = '800';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return text(405, 'Method Not Allowed');
  }

  if (!googlePlacePhotosEnabled()) {
    logFailure('', 'config', 503, 'google_place_photos_disabled');
    return noPhotoResponse(503);
  }

  const key = googlePlacesApiKey();
  if (!key) {
    logFailure('', 'config', 503, 'missing_api_key');
    return text(503, 'Google imagery is not configured.');
  }

  const q = event.queryStringParameters || {};
  const inputPhotoName = validPhotoName(q.photoName) ? cleanName(q.photoName) : '';
  const placeId = clean(q.placeId);

  if (!placeId) {
    logFailure('', 'request', 400, 'missing_placeId');
    return noPhotoResponse(400);
  }

  if (q.photoName && !inputPhotoName) {
    logFailure(placeId, 'request', 400, 'invalid_photoName');
    return noPhotoResponse(400);
  }

  if (inputPhotoName) {
    const suppliedImage = await fetchPhotoMedia(inputPhotoName, key, placeId);
    if (suppliedImage.ok) return imageResponse(suppliedImage, placeId);
  }

  const freshPhotoName = await fetchFreshPhotoName(placeId, key);
  if (!freshPhotoName) return noPhotoResponse();

  if (freshPhotoName !== inputPhotoName) {
    const freshImage = await fetchPhotoMedia(freshPhotoName, key, placeId);
    if (freshImage.ok) return imageResponse(freshImage, placeId);
  }

  return noPhotoResponse();
};

function googlePlacesApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
}

function googlePlacePhotosEnabled() {
  return String(process.env.ENABLE_GOOGLE_PLACE_PHOTOS || '').trim().toLowerCase() === 'true';
}

async function fetchFreshPhotoName(placeId, key) {
  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'photos',
      },
    });
    const contentType = cleanContentType(resp.headers.get('content-type'));
    const data = contentType.includes('application/json') ? await resp.json().catch(() => ({})) : {};
    const photos = Array.isArray(data.photos) ? data.photos : [];
    const fresh = photos.find((photo) => validPhotoName(photo && photo.name));
    const freshPhotoName = fresh ? cleanName(fresh.name) : '';

    console.log('PHOTO PLACE DETAILS', {
      placeId,
      status: resp.status,
      photoCount: photos.length,
    });

    if (!resp.ok) {
      logFailure(placeId, 'place_details', resp.status, googleErrorReason(data));
      return '';
    }

    if (!freshPhotoName) {
      logFailure(placeId, 'place_details', resp.status, 'no_google_photos');
      return '';
    }

    return freshPhotoName;
  } catch (err) {
    logFailure(placeId, 'place_details', 'FETCH_ERROR', err.message || String(err));
    return '';
  }
}

async function fetchPhotoMedia(photoName, key, placeId) {
  const safeName = cleanName(photoName);
  if (!validPhotoName(safeName)) {
    logFailure(placeId, 'media_request', 400, 'invalid_photoName');
    return { ok: false };
  }

  const mediaUrl = new URL(`https://places.googleapis.com/v1/${safeName}/media`);
  mediaUrl.searchParams.set('maxWidthPx', PHOTO_MAX_WIDTH);
  mediaUrl.searchParams.set('maxHeightPx', PHOTO_MAX_HEIGHT);
  mediaUrl.searchParams.set('skipHttpRedirect', 'false');
  mediaUrl.searchParams.set('key', key);

  try {
    const resp = await fetch(mediaUrl, { method: 'GET', redirect: 'follow' });
    const contentType = cleanContentType(resp.headers.get('content-type'));

    console.log('PHOTO MEDIA RESPONSE', {
      placeId,
      status: resp.status,
      contentType,
      redirected: !!resp.redirected,
    });

    if (!resp.ok) {
      const reason = contentType.includes('application/json')
        ? googleErrorReason(await resp.json().catch(() => ({})))
        : 'media_not_ok';
      logFailure(placeId, 'media_response', resp.status, reason);
      return { ok: false };
    }

    if (contentType.startsWith('image/')) {
      return imageFromResponse(resp, placeId, contentType);
    }

    logFailure(placeId, 'media_response', resp.status, 'non_image_response');
    return { ok: false };
  } catch (err) {
    logFailure(placeId, 'media_response', 'FETCH_ERROR', err.message || String(err));
    return { ok: false };
  }
}

async function imageFromResponse(resp, placeId, contentType) {
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (!buffer.length) {
    logFailure(placeId, 'final_image', resp.status, 'empty_image_body');
    return { ok: false };
  }

  return { ok: true, status: resp.status, contentType, buffer };
}

function imageResponse(image, placeId) {
  console.log('PHOTO FINAL IMAGE', {
    placeId,
    contentType: image.contentType,
    bytes: image.buffer.length,
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': image.contentType,
      'Cache-Control': 'public, max-age=86400',
    },
    isBase64Encoded: true,
    body: image.buffer.toString('base64'),
  };
}

function noPhotoResponse(statusCode = 204) {
  return {
    statusCode,
    headers: { 'Cache-Control': 'no-store' },
    body: '',
  };
}

function text(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body,
  };
}

function logFailure(placeId, stage, status, reason) {
  console.warn('PHOTO FAILED', {
    placeId,
    stage,
    status,
    reason: String(reason || 'unknown'),
  });
}

function googleErrorReason(data) {
  return (data && data.error && (data.error.message || data.error.status || data.error.code)) || 'google_error';
}

function cleanContentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function clean(value) {
  return String(value || '').trim();
}

function cleanName(value) {
  return clean(value).replace(/^\/+/, '');
}

function validPhotoName(value) {
  return /^places\/[^/]+\/photos\/[^/]+$/.test(cleanName(value));
}
