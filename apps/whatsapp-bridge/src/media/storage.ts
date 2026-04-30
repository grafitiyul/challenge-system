// Media storage abstraction. Phase 2 supports two backends — R2 (the
// intended production target, S3-compatible) and disk (temporary
// fallback for local dev or environments without R2 yet). Picking
// `MEDIA_STORAGE='disabled'` skips media downloads entirely; messages
// still ingest, but mediaUrl/mediaSizeBytes/mediaMimeType stay null.
//
// The interface is deliberately narrow: a Phase 2 ingest only needs
// to PUT bytes and get a stable URL/key back. Phase 3 (admin viewing)
// will add signed-URL resolution; that doesn't change this contract.

export interface MediaStoreInput {
  // Stable, content-addressable key inside the bucket / volume:
  //   whatsapp/<YYYY>/<MM>/<chatId>/<messageId>.<ext>
  // Date partitioning keeps any single directory under a few thousand
  // files; messageId is stable so re-running ingest on the same
  // message overwrites in place rather than producing duplicates.
  key: string;
  mimeType: string;
  data: Buffer;
}

export interface MediaStoreResult {
  // Public OR private URL. R2 with MEDIA_PUBLIC_URL_BASE set returns
  // a public URL; R2 without it returns `r2://bucket/key` (admin
  // resolver in Phase 3 will turn that into a signed URL on demand).
  // Disk returns `/uploads/whatsapp/...`.
  url: string;
  size: number;
}

export interface MediaStorage {
  // Identifier surfaced in logs + admin UI so the operator can tell
  // which backend is active. 'disabled' → media skipped entirely.
  readonly kind: 'r2' | 'disk' | 'disabled';
  store(input: MediaStoreInput): Promise<MediaStoreResult>;
}

// Storage that silently no-ops. Used when MEDIA_STORAGE='disabled'
// or when the configured backend can't initialise (e.g. R2 selected
// but env vars missing). The caller checks kind === 'disabled' to
// skip the download step entirely; if it ever reaches store(), we
// throw so a misconfigured deploy doesn't silently lose data.
export class DisabledMediaStorage implements MediaStorage {
  readonly kind = 'disabled' as const;
  async store(): Promise<MediaStoreResult> {
    throw new Error(
      '[bridge] MEDIA_STORAGE=disabled — media ingest path was reached unexpectedly',
    );
  }
}
