import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import postgres, { type Sql } from 'postgres';
import type { Env } from './_lib';

/**
 * Netlify platform bindings: environment, database and product-file storage.
 * Everything Netlify-specific lives here; the handlers in ./api only see the `Env` interface.
 */

/** Wraps Supabase PostgreSQL in the prepare → bind → first | all | run surface the handlers use. */
export function postgresDatabase(client: Sql): SqlDatabase {
  const toParams = (values: unknown[]): postgres.ParameterOrJSON<never>[] => values.map((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date || value instanceof Uint8Array) return value;
    throw new TypeError(`Unsupported PostgreSQL parameter type: ${typeof value}`);
  });
  return {
    prepare(statement: string) {
      return {
        bind(...values: unknown[]) {
          let index = 0;
          const query = statement.replace(/\?/g, () => `$${++index}`);
          if (index !== values.length) throw new Error(`SQL placeholder count (${index}) does not match value count (${values.length}).`);
          // postgres.js returns int8 (COUNT) and numeric (SUM) as strings; every such value here fits a JS number.
          const execute = async () => {
            const rows = await client.unsafe(query, toParams(values));
            const numeric = (rows.columns || []).filter((c) => c.type === 20 || c.type === 1700).map((c) => c.name);
            if (numeric.length) {
              for (const row of rows as Record<string, unknown>[]) {
                for (const name of numeric) if (row[name] != null) row[name] = Number(row[name]);
              }
            }
            return rows;
          };
          return {
            async first<T>() {
              const rows = await execute();
              return (rows[0] as T) ?? null;
            },
            async all<T>() {
              return { results: (await execute()).map((row) => ({ ...row })) as T[] };
            },
            async run() {
              const rows = await execute();
              return { meta: { changes: rows.count } };
            },
          };
        },
      };
    },
  };
}

/** Signed download URLs live for 1 minute; every Download click asks /api/files for a fresh one. */
export const DOWNLOAD_URL_SECONDS = 60;

/** Creates short-lived, attachment-only URLs for objects in a private Cloudflare R2 bucket. */
export function r2FileStore(accountId: string, accessKeyId: string, secretAccessKey: string, bucket: string): FileStore {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    async createDownloadUrl(key: string) {
      const filename = key.slice(key.lastIndexOf('/') + 1).replace(/["\\\r\n]/g, '_');
      return getSignedUrl(client, new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
        ResponseCacheControl: 'private, no-store',
      }), { expiresIn: DOWNLOAD_URL_SECONDS });
    },
    async exists(key: string) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (e) {
        if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
        throw e;
      }
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
    RESEND_API_KEY: e.RESEND_API_KEY,
    FROM_EMAIL: e.FROM_EMAIL,
    SUPPORT_EMAIL: e.SUPPORT_EMAIL,
    DB: e.SUPABASE_DB_URL ? postgresDatabase(postgres(e.SUPABASE_DB_URL, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    })) : undefined,
    PRODUCT_FILES: e.CLOUDFLARE_R2_ACCOUNT_ID && e.CLOUDFLARE_R2_ACCESS_KEY_ID
      && e.CLOUDFLARE_R2_SECRET_ACCESS_KEY && e.CLOUDFLARE_R2_BUCKET
      ? r2FileStore(e.CLOUDFLARE_R2_ACCOUNT_ID, e.CLOUDFLARE_R2_ACCESS_KEY_ID, e.CLOUDFLARE_R2_SECRET_ACCESS_KEY, e.CLOUDFLARE_R2_BUCKET)
      : undefined,
  };
  return cached;
}
