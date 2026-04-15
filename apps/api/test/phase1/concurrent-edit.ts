/**
 * Phase 1 Test — Concurrent edit.
 *
 * Invariant:
 *   Two concurrent correctLog() calls targeting the same active log cannot
 *   both succeed. UserActionLog.supersedesId has a unique constraint; the
 *   second concurrent writer gets a ConflictException. The chain retains
 *   exactly one superseding log.
 */

import { setupHarness, assert, pass } from './harness';

async function main() {
  const h = await setupHarness({ inputType: 'number', aggregationMode: 'incremental_sum', points: 1 });
  try {
    // Seed an active log we can race to edit.
    const first = await h.service.logAction({
      participantId: h.participantId,
      programId: h.programId,
      actionId: h.actionId,
      value: '100',
    });
    const originalLogId = first.log.id;

    // Fire two correctLog calls in parallel — identical target log.
    const results = await Promise.allSettled([
      h.service.correctLog({ logId: originalLogId, value: '200', actorRole: 'participant' }),
      h.service.correctLog({ logId: originalLogId, value: '300', actorRole: 'participant' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected  = results.filter((r) => r.status === 'rejected');
    assert(fulfilled.length === 1, `exactly ONE edit succeeded (got ${fulfilled.length})`);
    assert(rejected.length === 1,  `exactly ONE edit rejected (got ${rejected.length})`);

    // The rejection must be a ConflictException (409-style).
    const err = (rejected[0] as PromiseRejectedResult).reason as Error;
    assert(
      /corrected by another request|Conflict|409/i.test(err.message),
      `rejection carries conflict message (got "${err.message}")`,
    );

    // Supersession chain: original → exactly one successor.
    const successors = await h.prisma.userActionLog.findMany({
      where: { supersedesId: originalLogId },
    });
    assert(successors.length === 1, `exactly ONE superseding log (got ${successors.length})`);

    // chainRootId is consistent.
    const chain = await h.prisma.userActionLog.findMany({
      where: { chainRootId: originalLogId },
      orderBy: { createdAt: 'asc' },
    });
    assert(chain.length === 2, `chain has exactly 2 logs (got ${chain.length})`);
    assert(chain[0].status === 'superseded', 'original is marked superseded');
    assert(chain[1].status === 'active',     'successor is active');

    pass('concurrent-edit: unique(supersedesId) prevents forked chains');
  } finally {
    await h.cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
