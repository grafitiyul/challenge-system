// Cloudflare R2 / S3-compatible media storage for the API service.
//
// Used by the participant profile-portal /upload endpoint AND the
// admin /upload endpoint so EVERY participant-facing media write
// lands in R2 — never on Railway's ephemeral filesystem. The bridge
// has its own R2 client for inbound WhatsApp media; we deliberately
// don't share a singleton between services so the two can be
// configured independently.
//
// Required env (production):
//   R2_ENDPOINT             https://<account>.r2.cloudflarestorage.com
//                           (Cloudflare → R2 → API tokens; copy the
//                            "S3 API URL" exactly as shown.)
//   R2_BUCKET               bucket name
//   R2_ACCESS_KEY_ID        from a scoped R2 access key
//   R2_SECRET_ACCESS_KEY    from the same access key
//   MEDIA_PUBLIC_URL_BASE   public origin used to compose returned URLs.
//                           Either a Cloudflare custom domain (recommended)
//                           or the bucket's R2.dev URL. Without it,
//                           store() returns a placeholder `r2://` URL
//                           that admin/portal renderers can't display.
//
// Selection: the boot-time helper buildMediaStorage() inspects env and
// returns either an R2-backed implementation (when all four R2_* vars
// + MEDIA_PUBLIC_URL_BASE are set) or a local-disk fallback. The
// fallback is intended ONLY for local dev — in production it's a
// red flag and we log a warning so the operator notices.

import { PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { resolveUploadsDir } from './uploads-dir';

export interface MediaStoreInput {
  // Stable key inside the bucket (no leading slash). Layout suggestion:
  //   profile/<participantId>/<ts>_<rand>.<ext>
  // Date components aren't strictly needed — the participantId already
  // partitions and key collisions are virtually impossible with ts+rand.
  key: string;
  mimeType: string;
  data: Buffer;
}

export interface MediaStoreResult {
  // Public URL the browser can fetch directly. For R2 backend this is
  // MEDIA_PUBLIC_URL_BASE/<key>. For the disk fallback it's the
  // existing /uploads/<filename> shape so admin + portal renderers
  // (which already handle both) keep working unchanged.
  url: string;
  size: number;
  // Stable storage key — useful for delete / rename / signed-URL
  // operations later. R2: bucket-relative key. Disk: filename.
  key: string;
}

export interface MediaStorage {
  readonly kind: 'r2' | 'disk';
  store(input: MediaStoreInput): Promise<MediaStoreResult>;
  // Best-effort delete. Implementations MUST return ok=false rather
  // than throw on a missing object so a "delete from gallery" admin
  // action that races a concurrent re-upload doesn't blow up.
  remove(key: string): Promise<{ ok: boolean; reason?: string }>;
}

class R2MediaStorage implements MediaStorage {
  readonly kind = 'r2' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string;

  constructor(config: {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicUrlBase: string;
  }) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
    this.publicUrlBase = config.publicUrlBase.replace(/\/+$/, '');
  }

  async store(input: MediaStoreInput): Promise<MediaStoreResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.data,
        ContentType: input.mimeType,
      }),
    );
    return {
      url: `${this.publicUrlBase}/${input.key}`,
      size: input.data.byteLength,
      key: input.key,
    };
  }

  async remove(key: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message.split('\n')[0] : 'unknown',
      };
    }
  }
}

class DiskMediaStorage implements MediaStorage {
  readonly kind = 'disk' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  }

  async store(input: MediaStoreInput): Promise<MediaStoreResult> {
    // Disk fallback flattens the key — main.ts serves UPLOADS_DIR at
    // /uploads/* without subdirectory routing. Replace path separators
    // with underscores so the file lands as a single name.
    const filename = input.key.replace(/[\\/]/g, '_');
    const target = path.join(this.root, filename);
    fs.writeFileSync(target, input.data);
    return {
      url: `/uploads/${filename}`,
      size: input.data.byteLength,
      key: filename,
    };
  }

  async remove(key: string): Promise<{ ok: boolean; reason?: string }> {
    try {
      const target = path.join(this.root, key);
      if (fs.existsSync(target)) fs.unlinkSync(target);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message.split('\n')[0] : 'unknown',
      };
    }
  }
}

let cached: MediaStorage | null = null;

// Picks the storage backend at first call and memoizes. Logs which
// backend was chosen at boot — every operator can see this in the
// Railway log without grepping. In production you want kind=r2.
export function getMediaStorage(): MediaStorage {
  if (cached) return cached;
  const r2 = readR2Config();
  if (r2) {
    cached = new R2MediaStorage(r2);
    // eslint-disable-next-line no-console
    console.log(
      `[media] using R2 backend bucket=${r2.bucket} publicUrlBase=${r2.publicUrlBase}`,
    );
    return cached;
  }
  // No R2 configuration — fall back to local disk, with a warning so
  // the operator knows production media will be ephemeral.
  const root = resolveUploadsDir();
  cached = new DiskMediaStorage(root);
  // eslint-disable-next-line no-console
  console.warn(
    `[media] using DISK backend at ${root} — set R2_* + MEDIA_PUBLIC_URL_BASE for persistent storage`,
  );
  return cached;
}

// Read R2 env. Returns the populated config when ALL required vars
// are present, or null when ANY is missing. Empty strings count as
// missing — they're typical of partially-configured Railway services.
function readR2Config(): {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrlBase: string;
} | null {
  const endpoint        = (process.env['R2_ENDPOINT']           ?? '').trim();
  const bucket          = (process.env['R2_BUCKET']             ?? '').trim();
  const accessKeyId     = (process.env['R2_ACCESS_KEY_ID']      ?? '').trim();
  const secretAccessKey = (process.env['R2_SECRET_ACCESS_KEY']  ?? '').trim();
  const publicUrlBase   = (process.env['MEDIA_PUBLIC_URL_BASE'] ?? '').trim();
  // Without MEDIA_PUBLIC_URL_BASE the returned URL would be
  // unusable from the browser — we treat its absence as "R2 not
  // ready" and log loudly via the caller's fallback path.
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicUrlBase) {
    return null;
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey, publicUrlBase };
}

// Generate a content-addressable key inside R2 / disk. Layout:
//   <prefix>/<ownerId>/<ts>_<rand><ext>
// The prefix lets us tell admin uploads from participant uploads in
// the bucket without a separate query. ownerId scopes per participant
// so a `aws s3 ls` per user is a single prefix scan.
export function generateStorageKey(
  prefix: 'profile' | 'admin',
  ownerId: string,
  originalname: string,
): string {
  const ext = path.extname(originalname).toLowerCase().replace(/[^.a-z0-9]/g, '');
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  // Owner-scoped subprefix; safe-character-only name.
  const safeOwner = ownerId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${prefix}/${safeOwner}/${ts}_${rand}${ext}`;
}

// Validation helper — boot-time call from main.ts. When NODE_ENV
// looks production-y we want a hard fail, not a silent disk fallback,
// because the disk on Railway is ephemeral and uploads vanish on
// every redeploy. In dev we just warn.
export function validateMediaStorageOrThrow(): void {
  const r2 = readR2Config();
  const isProd = process.env['NODE_ENV'] === 'production'
    || !!process.env['RAILWAY_ENVIRONMENT_NAME']
    || !!process.env['RAILWAY_SERVICE_ID'];
  if (r2) {
    // eslint-disable-next-line no-console
    console.log('[media] R2 config OK');
    return;
  }
  const missing: string[] = [];
  if (!process.env['R2_ENDPOINT'])           missing.push('R2_ENDPOINT');
  if (!process.env['R2_BUCKET'])             missing.push('R2_BUCKET');
  if (!process.env['R2_ACCESS_KEY_ID'])      missing.push('R2_ACCESS_KEY_ID');
  if (!process.env['R2_SECRET_ACCESS_KEY'])  missing.push('R2_SECRET_ACCESS_KEY');
  if (!process.env['MEDIA_PUBLIC_URL_BASE']) missing.push('MEDIA_PUBLIC_URL_BASE');
  const msg = `[media] R2 not configured — missing: ${missing.join(', ')}`;
  if (isProd) {
    throw new Error(`${msg}. Set these env vars on the api service before deploying.`);
  }
  // eslint-disable-next-line no-console
  console.warn(`${msg}. Falling back to local disk (dev only).`);
}
