// Cloudflare R2 storage via the S3-compatible API. Production target.
//
// Required env (validated when MEDIA_STORAGE='r2' is selected):
//   R2_ENDPOINT             https://<account>.r2.cloudflarestorage.com
//   R2_BUCKET               bucket name
//   R2_ACCESS_KEY_ID        token-derived
//   R2_SECRET_ACCESS_KEY    token-derived
//
// Optional:
//   MEDIA_PUBLIC_URL_BASE   if set, store() returns a direct public URL
//                           (custom domain or worker-fronted endpoint)
//                           instead of an `r2://` placeholder.
//
// "Do not store media as public links unless explicitly configured" —
// the caller decides by setting MEDIA_PUBLIC_URL_BASE. If they want
// signed URLs (Phase 3 admin viewing), the resolver layer can take an
// `r2://bucket/key` placeholder and mint a presigned GET on demand.

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MediaStorage, MediaStoreInput, MediaStoreResult } from './storage';

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrlBase?: string;
}

export class R2MediaStorage implements MediaStorage {
  readonly kind = 'r2' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicUrlBase: string | undefined;

  constructor(config: R2Config) {
    this.client = new S3Client({
      // R2's S3-compatible endpoint expects path-style addressing and
      // the synthetic 'auto' region — the account-scoped endpoint URL
      // is what routes the request to the right Cloudflare DC.
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.bucket = config.bucket;
    this.publicUrlBase = config.publicUrlBase?.replace(/\/+$/, '');
  }

  async store(input: MediaStoreInput): Promise<MediaStoreResult> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.data,
        ContentType: input.mimeType,
        // No ACL — R2 buckets are private by default and we keep them
        // that way unless MEDIA_PUBLIC_URL_BASE is explicitly set
        // (which implies the operator has fronted the bucket with a
        // custom-domain CDN that handles auth).
      }),
    );

    const url = this.publicUrlBase
      ? `${this.publicUrlBase}/${input.key}`
      : `r2://${this.bucket}/${input.key}`;

    return { url, size: input.data.byteLength };
  }
}
