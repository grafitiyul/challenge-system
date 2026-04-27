// Resolves the on-disk directory where uploaded files live. The path is
// shared between:
//   - main.ts         — registers `/uploads/*` static asset middleware
//   - upload.controller.ts — multer disk storage destination
// so the static URL and the actual file location stay in lockstep.
//
// Production (Railway): the api service must mount a persistent volume
// at the path pointed to by UPLOADS_DIR. Without that volume the
// filesystem is wiped on every redeploy and uploaded avatars / before
// photos disappear. Set UPLOADS_DIR=/data/uploads (or whatever the
// volume mount path is) on the api service env vars.
//
// Local dev: leave UPLOADS_DIR unset → falls back to the project's
// existing ./uploads directory next to the api app.

import * as path from 'path';
import * as fs from 'fs';

export function resolveUploadsDir(): string {
  const fromEnv = process.env['UPLOADS_DIR'];
  const dir = fromEnv && fromEnv.trim()
    ? path.resolve(fromEnv.trim())
    : path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
