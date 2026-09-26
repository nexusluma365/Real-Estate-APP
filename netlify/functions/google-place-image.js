// GET /.netlify/functions/google-place-image?placeId=...
//
// Server-side proxy for Google Places photos. The browser never receives
// the Google API key; it only receives a binary image response or a controlled
// no-photo response.

const PHOTO_MAX_WIDTH = '1200';
const PHOTO_MAX_HEIGHT = '800';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return text(405, 'Method Not Allowed');
  }

  const key = googlePlacesApiKey();
  if (!key) {
    logFailure('', 'config', 503, 'missing_api_key');
    return text(503, 'Google imagery is not configured.');
  }

  const q = event.queryStringParameters || {};
  const inputPhotoReference = clean(q.photoName);
  const placeId = clean(q.placeId);

  if (!placeId) {
    logFailure('', 'request', 400, 'missing_placeId');
    return noPhotoResponse(400);
  }

  const freshPhotoReference = await fetchFreshPhotoReference(placeId, key);
  const photoReference = freshPhotoReference || inputPhotoReference;
  if (!photoReference) return noPhotoResponse();

  const freshImage = await fetchPhotoMedia(photoReference, key, placeId);
  if (freshImage.ok) return imageResponse(freshImage, placeId);

  return noPhotoResponse();
};

function googlePlacesApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
}

async function fetchFreshPhotoReference(placeId, key) {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', 'photos');
  url.searchParams.set('key', key);

  try {
    const resp = await fetch(url, { method: 'GET' });
    const contentType = cleanContentType(resp.headers.get('content-type'));
    const data = contentType.includes('application/json') ? await resp.json().catch(() => ({})) : {};
    const photos = data && data.result && Array.isArray(data.result.photos) ? data.result.photos : [];
    const fresh = photos.find((photo) => photo && typeof photo.photo_reference === 'string' && photo.photo_reference.trim());
    const freshPhotoReference = fresh ? clean(fresh.photo_reference) : '';

    console.log('PHOTO PLACE DETAILS', {
      placeId,
      status: resp.status,
      photoCount: photos.length,
    });

    if (!resp.ok) {
      logFailure(placeId, 'place_details', resp.status, googleErrorReason(data));
      return '';
    }

    if (!freshPhotoReference) {
      logFailure(placeId, 'place_details', resp.status, 'no_google_photos');
      return '';
    }

    return freshPhotoReference;
  } catch (err) {
    logFailure(placeId, 'place_details', 'FETCH_ERROR', err.message || String(err));
    return '';
  }
}

async function fetchPhotoMedia(photoReference, key, placeId) {
  const safeReference = clean(photoReference);
  if (!safeReference) {
    logFailure(placeId, 'media_request', 400, 'invalid_photoReference');
    return { ok: false };
  }

  const mediaUrl = new URL('https://maps.googleapis.com/maps/api/place/photo');
  mediaUrl.searchParams.set('maxwidth', PHOTO_MAX_WIDTH);
  mediaUrl.searchParams.set('maxheight', PHOTO_MAX_HEIGHT);
  mediaUrl.searchParams.set('photoreference', safeReference);
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
  return (data && data.error_message) || (data && data.error && (data.error.message || data.error.status || data.error.code)) || 'google_error';
}

function cleanContentType(value) {
  return String(value || '').split(';')[0].trim().toLowerCase();
}

function clean(value) {
  return String(value || '').trim();
}
