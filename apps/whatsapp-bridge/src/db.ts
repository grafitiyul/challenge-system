// Single PrismaClient for the bridge process. The API has its own
// Prisma instance — separate connection pools, same database, same
// generated client (npm workspaces hoists @prisma/client to the
// monorepo root, so apps/api's `prisma generate` covers us too).
//
// Pool size is left at the Prisma default (~num_cpus * 2 + 1) which is
// fine for the bridge's traffic shape: a steady trickle of upserts,
// no burst patterns.

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

export async function shutdown(): Promise<void> {
  await prisma.$disconnect();
}
