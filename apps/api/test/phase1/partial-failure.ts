/**
 * Phase 1 Test — Partial failure inside a transaction.
 *
 * Invariant:
 *   If any write inside the SERIALIZABLE submission transaction throws, NOTHING
 *   is persisted. We simulate the failure by passing an invalid contextJson that
 *   violates the action's contextSchemaJson — validation runs BEFORE the
 *   transaction, so NO rows should be created.
 *
 *   Then we simulate a failure MID-transaction by forcing a DB-level collision:
 *   attempt to insert a log with a clientSubmissionId that is already taken by
 *   a different participant. The unique index on clientSubmissionId rejects the
 *   second insert; the whole transaction rolls back.
 */

import { setupHarness, assert, pass } from './harness';

async function main() {
  // ── Scenario A: validation failure — nothing written ────────────────────
  {
    const h = await setupHarness({ inputType: 'boolean', points: 10 });
    try {
      await h.prisma.gameAction.update({
        where: { id: h.actionId },
        data: {
          contextSchemaJson: {
            dimensions: [
              { key: 'slot', label: 'Slot', type: 'select', required: true, options: [
                { value: 'am', label: 'AM' },
                { value: 'pm', label: 'PM' },
              ] },
            ],
          },
        },
      });

      let threw = false;
      try {
        await h.service.logAction({
          participantId: h.participantId,
          programId: h.programId,
          actionId: h.actionId,
          contextJson: { slot: 'invalid_value' }, // not in options
        });
      } catch {
        threw = true;
      }
      assert(threw, 'invalid context value rejected');

      const logCount = await h.prisma.userActionLog.count({
        where: { participantId: h.participantId },
      });
      const seCount = await h.prisma.scoreEvent.count({
        where: { participantId: h.participantId },
      });
      assert(logCount === 0, `Scenario A: zero logs persisted (got ${logCount})`);
      assert(seCount === 0,  `Scenario A: zero score events persisted (got ${seCount})`);
      pass('partial-failure (A): validation error leaves zero rows');
    } finally {
      await h.cleanup();
    }
  }

  // ── Scenario B: unique-constraint failure mid-transaction ───────────────
  {
    const h1 = await setupHarness({ inputType: 'boolean', points: 10 });
    const h2 = await setupHarness({ inputType: 'boolean', points: 10 });
    try {
      const sharedKey = `dup-scenario-b-${Date.now()}`;

      // First submission claims the idempotency key for participant #1.
      await h1.service.logAction({
        participantId: h1.participantId,
        programId: h1.programId,
        actionId: h1.actionId,
        clientSubmissionId: sharedKey,
      });

      // Second submission (different participant) using the SAME key must fail.
      // Because clientSubmissionId is globally unique, the second insert collides.
      // Expected: the transaction rolls back — no log, no score event for participant #2.
      let threw = false;
      try {
        await h2.service.logAction({
          participantId: h2.participantId,
          programId: h2.programId,
          actionId: h2.actionId,
          clientSubmissionId: sharedKey,
        });
      } catch {
        threw = true;
      }
      assert(threw, 'key collision across participants rejected');

      const p2Logs = await h2.prisma.userActionLog.count({
        where: { participantId: h2.participantId },
      });
      const p2Events = await h2.prisma.scoreEvent.count({
        where: { participantId: h2.participantId },
      });
      assert(p2Logs === 0,  `Scenario B: participant#2 has zero logs (got ${p2Logs})`);
      assert(p2Events === 0, `Scenario B: participant#2 has zero events (got ${p2Events})`);
      pass('partial-failure (B): unique-violation rollback leaves zero participant#2 rows');
    } finally {
      await h1.cleanup();
      await h2.cleanup();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
