import { env, isMock } from './env';

/**
 * GET /api/files?key=… checks the session's entitlement server-side and redirects to a short-lived
 * signed URL from the private Cloudflare R2 bucket (the HttpOnly session cookie is sent to our API).
 * Files are never public, so guessing a key never grants access.
 */
export async function getDownloadUrl(fileKey: string): Promise<string | null> {
  if (isMock) return null;
  return `${env.apiBase}/files?key=${encodeURIComponent(fileKey)}`;
}
