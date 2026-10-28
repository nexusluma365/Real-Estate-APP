import { env, isMock } from './env';

/**
 * GET /api/files?key=… checks the session's entitlement server-side and streams the file from the
 * private Netlify Blobs store (HttpOnly session cookie is sent on navigation). Files are never public, so guessing a
 * URL never grants access.
 */
export async function getDownloadUrl(fileKey: string): Promise<string | null> {
  if (isMock) return null;
  return `${env.apiBase}/files?key=${encodeURIComponent(fileKey)}`;
}
