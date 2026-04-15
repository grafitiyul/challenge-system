/**
 * Phase 1 Test — Rule event dependency linking.
 *
 * Invariant:
 *   When a rule fires in response to an action submission:
 *     - The rule's ScoreEvent has sourceType='rule' and bucketKey set (YYYY-MM-DD).
 *     - parentEventId points to the triggering action's ScoreEvent.
 *     - At least one ScoreEventDependency row links rule.id → action.id.
 */

import { setupHarness, assert, pass } from './harness';

async function main() {
  const h = await setupHarness({ inputType: 'boolean', points: 10 });
  try {
    // Seed a daily_bonus rule (fires once per day for any action submission).
    const rule = await h.prisma.gameRule.create({
      data: {
        programId: h.programId,
        name: 'daily-bonus-test',
        type: 'daily_bonus',
        conditionJson: {},
        rewardJson: { points: 5 },
        activationType: 'immediate',
      },
    });

    // Submit one action — should fire the rule.
    const submission = await h.service.logAction({
      participantId: h.participantId,
      programId: h.programId,
      actionId: h.actionId,
    });
    assert(submission.scoreEvent, 'submission produced an action ScoreEvent');
    const actionEventId = submission.scoreEvent!.id;

    // Rule event must exist.
    const ruleEvents = await h.prisma.scoreEvent.findMany({
      where: {
        participantId: h.participantId,
        sourceType: 'rule',
        sourceId: rule.id,
      },
    });
    assert(ruleEvents.length === 1, `exactly one rule event (got ${ruleEvents.length})`);
    const ruleEvent = ruleEvents[0];

    // bucketKey is today in YYYY-MM-DD.
    const todayBucket = new Date().toISOString().slice(0, 10);
    assert(
      ruleEvent.bucketKey === todayBucket,
      `rule event bucketKey="${todayBucket}" (got "${ruleEvent.bucketKey}")`,
    );

    // parentEventId links to the triggering action event.
    assert(
      ruleEvent.parentEventId === actionEventId,
      `rule parentEventId=${actionEventId} (got ${ruleEvent.parentEventId})`,
    );

    // ScoreEventDependency row links rule → action event.
    const dep = await h.prisma.scoreEventDependency.findFirst({
      where: { eventId: ruleEvent.id, dependsOnEventId: actionEventId },
    });
    assert(dep !== null, 'ScoreEventDependency row exists (rule depends on action event)');

    // Second submission SAME day must NOT fire the rule again (bucketKey dedup).
    const second = await h.service.logAction({
      participantId: h.participantId,
      programId: h.programId,
      actionId: h.actionId,
    });
    assert(second.scoreEvent, 'second submission produced an action ScoreEvent');
    const ruleEvents2 = await h.prisma.scoreEvent.count({
      where: { participantId: h.participantId, sourceType: 'rule', sourceId: rule.id },
    });
    assert(ruleEvents2 === 1, `rule event NOT re-fired same day (got ${ruleEvents2})`);

    // Cleanup the rule (cascade via ScoreEventDependency.onDelete cascade)
    await h.prisma.scoreEventDependency.deleteMany({ where: { eventId: ruleEvent.id } });
    await h.prisma.feedEvent.deleteMany({ where: { participantId: h.participantId } });
    await h.prisma.scoreEvent.deleteMany({ where: { participantId: h.participantId } });
    await h.prisma.gameRule.delete({ where: { id: rule.id } });

    pass('dependency-linking: rule events carry bucketKey, parentEventId, and dependency rows');
  } finally {
    await h.cleanup();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
