// Selects which MediaStorage implementation to use, based on env.
//
// Decision tree:
//   MEDIA_STORAGE=r2       → R2MediaStorage; throws at boot if any of
//                            R2_ENDPOINT/R2_BUCKET/keys are missing.
//   MEDIA_STORAGE=disk     → DiskMediaStorage rooted at UPLOADS_DIR
//                            (or "./uploads" if unset).
//   MEDIA_STORAGE=disabled → DisabledMediaStorage. Messages still
//                            ingest; media downloads are skipped.
//   default                → 'disabled' (safe — no surprise disk
//                            writes on a fresh deploy).
//
// The boot log includes which backend was picked so the operator can
// see at a glance whether media is being archived.

import path from 'path';
import { config } from '../config';
import { DisabledMediaStorage, MediaStorage } from './storage';
import { DiskMediaStorage } from './disk-storage';
import { R2MediaStorage } from './r2-storage';

export function buildMediaStorage(): MediaStorage {
  switch (config.mediaStorage) {
    case 'r2': {
      if (!config.r2Endpoint || !config.r2Bucket || !config.r2AccessKeyId || !config.r2SecretAccessKey) {
        throw new Error(
          '[bridge] MEDIA_STORAGE=r2 selected but R2_ENDPOINT / R2_BUCKET / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not all set',
        );
      }
      return new R2MediaStorage({
        endpoint: config.r2Endpoint,
        bucket: config.r2Bucket,
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
        publicUrlBase: config.mediaPublicUrlBase,
      });
    }
    case 'disk': {
      const root = process.env['UPLOADS_DIR']
        ? path.resolve(process.env['UPLOADS_DIR'])
        : path.resolve(process.cwd(), 'uploads');
      return new DiskMediaStorage(root);
    }
    case 'disabled':
    default:
      return new DisabledMediaStorage();
  }
}
