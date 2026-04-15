/**
 * Phase 1 Test — Duplicate submission with same Idempotency-Key.
 *
 * Invariant:
 *   Two logAction() calls with identical clientSubmissionId produce exactly
 *   ONE UserActionLog and ONE action ScoreEvent. The second call returns the
 *   original result with { replayed: true }. Points awarded are not doubled.
 */

import { setupHarness, assert, pass } from './harness';

async function main() {
  const h = await setupHarness({ inputType: 'boolean', points: 10 });
  try {
    const key = `idemp-${Date.now()}`;

    const first = await h.service.logAction({
      participantId: h.participantId,
      programId: h.programId,
      actionId: h.actionId,
      clientSubmissionId: key,
    });
    assert(first.log, 'first call returned a log');
    assert(first.scoreEvent, 'first call returned a scoreEvent');
    assert(!('replayed' in first && first.replayed), 'first call is not a replay');

    const second = await h.service.logAction({
      participantId: h.participantId,
      programId: h.programId,
      actionId: h.actionId,
      clientSubmissionId: key,
    });
    assert(second.log.id === first.log.id, 'second call returned the SAME log id');
    assert(
      (second as { replayed?: boolean }).replayed === true,
      'second call is flagged replayed',
    );

    const logCount = await h.prisma.userActionLog.count({
      where: { participantId: h.participantId, actionId: h.actionId },
    });
    assert(logCount === 1, `exactly ONE log persisted (got ${logCount})`);

    const seCount = await h.prisma.scoreEvent.count({
      where: { participantId: h.participantId, sourceType: 'action' },
    });
    assert(seCount === 1, `exactly ONE action ScoreEvent persisted (got ${seCount})`);

    const totalPoints = await h.prisma.scoreEvent.aggregate({
      _sum: { points: true },
      where: { participantId: h.participantId },
    });
    assert(
      totalPoints._sum.points === 10,
      `points are NOT doubled (expected 10, got ${totalPoints._sum.points})`,
    );

    pass('duplicate-submission: idempotency key collapses retry to a single event');
  } finally {
    await h.cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
