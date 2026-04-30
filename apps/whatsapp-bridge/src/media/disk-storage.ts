// Disk-backed media storage. Marked TEMPORARY in the README — R2 is
// the intended production target. Disk is here for local dev and as
// an emergency fallback when R2 isn't reachable.
//
// Files land under <UPLOADS_DIR>/whatsapp/<key>. UPLOADS_DIR defaults
// to "./uploads" locally and is set to "/data/uploads" on Railway via
// the persistent volume the participant-portal already uses. The
// stored URL is "/uploads/whatsapp/<key>" — same shape the API's
// static middleware already serves under /uploads.
//
// Atomicity: write to "<file>.partial", fsync, rename. If the bridge
// crashes mid-download we don't leave a half-file the admin thinks is
// real.

import fs from 'fs';
import path from 'path';
import { MediaStorage, MediaStoreInput, MediaStoreResult } from './storage';

export class DiskMediaStorage implements MediaStorage {
  readonly kind = 'disk' as const;
  private readonly root: string;
  private readonly publicPrefix: string;

  constructor(root: string, publicPrefix: string = '/uploads') {
    this.root = root;
    this.publicPrefix = publicPrefix;
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true });
    }
  }

  async store(input: MediaStoreInput): Promise<MediaStoreResult> {
    const fullPath = path.join(this.root, input.key);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = `${fullPath}.partial`;
    await fs.promises.writeFile(tmpPath, input.data);
    // Best-effort fsync — not all filesystems honour it identically;
    // the rename below is the actual durability boundary.
    try {
      const fh = await fs.promises.open(tmpPath, 'r');
      await fh.sync();
      await fh.close();
    } catch {
      /* non-fatal */
    }
    await fs.promises.rename(tmpPath, fullPath);

    return {
      url: `${this.publicPrefix}/${input.key.split(path.sep).join('/')}`,
      size: input.data.byteLength,
    };
  }
}
