// GET /.netlify/functions/google-place-image?photoName=places/.../photos/...&placeId=...
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

  const key = googlePlacesApiKey();
  if (!key) {
    logFailure('', 'config', 503, '', 'missing_api_key');
    return text(503, 'Google imagery is not configured.');
  }

  const q = event.queryStringParameters || {};
  const inputPhotoName = validPhotoName(q.photoName) ? cleanName(q.photoName) : '';
  const placeId = clean(q.placeId) || placeIdFromPhotoName(inputPhotoName);

  console.log('PHOTO PIPELINE 1 - REQUEST', {
    placeId,
    hasPhotoName: !!inputPhotoName,
  });

  if (!inputPhotoName && !placeId) {
    logFailure('', 'request', 400, '', 'missing_photoName_and_placeId');
    return noPhotoResponse(400);
  }

  if (q.photoName && !inputPhotoName && !placeId) {
    logFailure('', 'request', 400, '', 'invalid_photoName');
    return noPhotoResponse(400);
  }

  const attempted = new Set();
  let photoName = inputPhotoName;

  if (photoName) {
    const image = await fetchPhotoMedia(photoName, key, placeId, attempted);
    if (image.ok) return imageResponse(image, placeId);
  }

  if (!placeId) {
    logFailure('', 'place_details', 204, '', 'placeId_unavailable_for_refresh');
    return noPhotoResponse();
  }

  const freshPhotoName = await fetchFreshPhotoName(placeId, key);
  if (!freshPhotoName) return noPhotoResponse();

  if (freshPhotoName === photoName && attempted.has(freshPhotoName)) {
    logFailure(placeId, 'media_retry', 204, '', 'fresh_photoName_already_attempted');
    return noPhotoResponse();
  }

  const freshImage = await fetchPhotoMedia(freshPhotoName, key, placeId, attempted);
  if (freshImage.ok) return imageResponse(freshImage, placeId);

  return noPhotoResponse();
};

function googlePlacesApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
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

    console.log('PHOTO PIPELINE 2 - PLACE DETAILS', {
      placeId,
      status: resp.status,
      contentType,
      photoCount: photos.length,
      hasFreshPhotoName: !!freshPhotoName,
    });

    if (!resp.ok) {
      logFailure(placeId, 'place_details', resp.status, contentType, googleErrorReason(data));
      return '';
    }

    if (!freshPhotoName) {
      console.warn('PHOTO PIPELINE - NO GOOGLE PHOTOS', { placeId });
      return '';
    }

    return freshPhotoName;
  } catch (err) {
    logFailure(placeId, 'place_details', 'FETCH_ERROR', '', err.message || String(err));
    return '';
  }
}

async function fetchPhotoMedia(photoName, key, placeId, attempted) {
  const safeName = cleanName(photoName);
  if (!validPhotoName(safeName)) {
    logFailure(placeId, 'media_request', 400, '', 'invalid_photoName');
    return { ok: false };
  }

  attempted.add(safeName);

  console.log('PHOTO PIPELINE 3 - MEDIA REQUEST', {
    placeId,
    hasPhotoName: true,
  });

  const mediaUrl = new URL(`https://places.googleapis.com/v1/${safeName}/media`);
  mediaUrl.searchParams.set('maxWidthPx', PHOTO_MAX_WIDTH);
  mediaUrl.searchParams.set('maxHeightPx', PHOTO_MAX_HEIGHT);
  mediaUrl.searchParams.set('skipHttpRedirect', 'false');
  mediaUrl.searchParams.set('key', key);

  try {
    const resp = await fetch(mediaUrl, { method: 'GET', redirect: 'follow' });
    const contentType = cleanContentType(resp.headers.get('content-type'));

    console.log('PHOTO PIPELINE 4 - MEDIA RESPONSE', {
      placeId,
      status: resp.status,
      contentType,
      redirected: !!resp.redirected,
    });

    if (!resp.ok) {
      const reason = contentType.includes('application/json')
        ? googleErrorReason(await resp.json().catch(() => ({})))
        : 'media_not_ok';
      logFailure(placeId, 'media_response', resp.status, contentType, reason);
      return { ok: false };
    }

    if (contentType.startsWith('image/')) {
      return imageFromResponse(resp, placeId, contentType);
    }

    if (contentType.includes('application/json')) {
      const data = await resp.json().catch(() => ({}));
      if (data && data.photoUri) {
        return fetchPhotoUri(data.photoUri, placeId);
      }
      logFailure(placeId, 'media_json', resp.status, contentType, 'json_without_photoUri');
      return { ok: false };
    }

    logFailure(placeId, 'media_response', resp.status, contentType, 'non_image_response');
    return { ok: false };
  } catch (err) {
    logFailure(placeId, 'media_response', 'FETCH_ERROR', '', err.message || String(err));
    return { ok: false };
  }
}

async function fetchPhotoUri(photoUri, placeId) {
  let url;
  try {
    url = new URL(String(photoUri || ''));
  } catch (_err) {
    logFailure(placeId, 'photoUri', 400, '', 'invalid_photoUri');
    return { ok: false };
  }

  try {
    const resp = await fetch(url, { method: 'GET', redirect: 'follow' });
    const contentType = cleanContentType(resp.headers.get('content-type'));

    console.log('PHOTO PIPELINE 4 - MEDIA RESPONSE', {
      placeId,
      status: resp.status,
      contentType,
      redirected: !!resp.redirected,
    });

    if (!resp.ok) {
      logFailure(placeId, 'photoUri', resp.status, contentType, 'photoUri_not_ok');
      return { ok: false };
    }
    if (!contentType.startsWith('image/')) {
      logFailure(placeId, 'photoUri', resp.status, contentType, 'photoUri_non_image_response');
      return { ok: false };
    }

    return imageFromResponse(resp, placeId, contentType);
  } catch (err) {
    logFailure(placeId, 'photoUri', 'FETCH_ERROR', '', err.message || String(err));
    return { ok: false };
  }
}

async function imageFromResponse(resp, placeId, contentType) {
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (!buffer.length) {
    logFailure(placeId, 'final_image', resp.status, contentType, 'empty_image_body');
    return { ok: false };
  }

  return { ok: true, status: resp.status, contentType, buffer };
}

function imageResponse(image, placeId) {
  console.log('PHOTO PIPELINE 5 - FINAL IMAGE', {
    placeId,
    status: image.status || 200,
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

function logFailure(placeId, stage, status, contentType, reason) {
  console.warn('PHOTO PIPELINE FAILED', {
    placeId,
    stage,
    status,
    contentType: contentType || '',
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

function placeIdFromPhotoName(name) {
  const match = cleanName(name).match(/^places\/([^/]+)\/photos\//);
  return match ? match[1] : '';
}
