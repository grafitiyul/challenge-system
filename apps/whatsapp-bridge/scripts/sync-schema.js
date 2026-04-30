// Sync apps/whatsapp-bridge/prisma/schema.prisma from
// apps/api/prisma/schema.prisma. The API schema is the single source
// of truth; the bridge keeps a committed copy so it can deploy
// stand-alone (Railway with Root Directory = apps/whatsapp-bridge
// has no access to apps/api/).
//
// Behaviour:
//   - When the API schema is reachable (monorepo checkout, local dev,
//     and any CI/build env that has the full repo): copy it over
//     unconditionally. Idempotent — copying an identical file is a
//     no-op for downstream tooling.
//   - When the API schema is NOT reachable (sparse checkout, Railway
//     with Root Directory set to the bridge): skip silently and leave
//     the committed local copy in place. The local copy is what
//     prisma generate / migrate deploy will read.
//
// Cross-platform — Node fs only, no shell dependencies. Runs from any
// working directory because all paths are derived from __dirname.

'use strict';

const fs = require('fs');
const path = require('path');

const sourceSchema = path.resolve(__dirname, '..', '..', 'api', 'prisma', 'schema.prisma');
const targetSchema = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');

if (!fs.existsSync(sourceSchema)) {
  // Sparse checkout (Railway with Root Directory = apps/whatsapp-bridge).
  // The committed local copy is authoritative here.
  console.log('[bridge sync-schema] api schema not present at %s — using committed local copy', sourceSchema);
  process.exit(0);
}

if (!fs.existsSync(targetSchema)) {
  // First-time setup: the local copy was deleted or never committed.
  // Create the target directory if needed and copy.
  fs.mkdirSync(path.dirname(targetSchema), { recursive: true });
}

const before = fs.existsSync(targetSchema) ? fs.readFileSync(targetSchema) : null;
fs.copyFileSync(sourceSchema, targetSchema);
const after = fs.readFileSync(targetSchema);

if (before && Buffer.compare(before, after) === 0) {
  console.log('[bridge sync-schema] local schema already in sync with api/');
} else {
  console.log('[bridge sync-schema] copied %s → %s', sourceSchema, targetSchema);
}
