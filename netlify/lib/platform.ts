import { createClient, type Client, type InValue } from '@libsql/client/web';
import { getStore } from '@netlify/blobs';
import type { Env } from './_lib';

/**
 * Netlify platform bindings: environment, database and product-file storage.
 * Everything Netlify-specific lives here; the handlers in ./api only see the `Env` interface.
 */

/** Wraps a libSQL (Turso) client in the prepare → bind → first | all | run surface the handlers use. */
export function sqlDatabase(client: Pick<Client, 'execute'>): SqlDatabase {
  const toArgs = (v: unknown[]): InValue[] => v.map((x) => (x === undefined ? null : typeof x === 'boolean' ? (x ? 1 : 0) : (x as InValue)));
  const toRows = (rs: { columns: string[]; rows: ArrayLike<unknown>[] }) =>
    rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, (r as unknown as unknown[])[i]])));
  return {
    prepare(sql: string) {
      return {
        bind(...v: unknown[]) {
          const exec = () => client.execute({ sql, args: toArgs(v) });
          return {
            async first<T>() {
              const rs = await exec();
              return (toRows(rs)[0] as T) ?? null;
            },
            async all<T>() {
              return { results: toRows(await exec()) as T[] };
            },
            async run() {
              const rs = await exec();
              return { meta: { changes: rs.rowsAffected } };
            },
          };
        },
      };
    },
  };
}

const TYPES: Record<string, string> = { pdf: 'application/pdf', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };

/** Netlify Blobs store "product-files" (private). Upload with: netlify blobs:set product-files <key> --input <file> */
export function blobFileStore(): FileStore {
  return {
    async get(key: string) {
      const store = getStore({ name: 'product-files', consistency: 'strong' }); // lazy: needs the Netlify runtime
      const hit = await store.getWithMetadata(key, { type: 'stream' });
      if (!hit) return null;
      const ext = key.split('.').pop()?.toLowerCase() || '';
      const contentType = (hit.metadata?.contentType as string | undefined) || TYPES[ext] || 'application/octet-stream';
      return { body: hit.data as ReadableStream, httpMetadata: { contentType } };
    },
  };
}

let cached: Env | null = null;

/** Builds Env from Netlify environment variables (Site settings → Environment variables). */
export function netlifyEnv(): Env {
  if (cached) return cached;
  const e = process.env;
  cached = {
    STRIPE_SECRET_KEY: e.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: e.STRIPE_WEBHOOK_SECRET,
    SESSION_SECRET: e.SESSION_SECRET,
    TURNSTILE_SECRET_KEY: e.TURNSTILE_SECRET_KEY,
    ALLOWED_ORIGIN: e.ALLOWED_ORIGIN,
    ESP_WEBHOOK_URL: e.ESP_WEBHOOK_URL,
    ESP_WEBHOOK_SECRET: e.ESP_WEBHOOK_SECRET,
    ADMIN_TOKEN: e.ADMIN_TOKEN,
    VIDEO_GUIDE_URL: e.VIDEO_GUIDE_URL,
    DB: e.TURSO_DATABASE_URL ? sqlDatabase(createClient({ url: e.TURSO_DATABASE_URL, authToken: e.TURSO_AUTH_TOKEN })) : undefined,
    PRODUCT_FILES: e.PRODUCT_FILES_DISABLED === 'true' ? undefined : blobFileStore(),
  };
  return cached;
}
