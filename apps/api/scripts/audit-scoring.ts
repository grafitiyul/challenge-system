/**
 * Scoring audit — prints a breakdown of recent UserActionLogs, the
 * ScoreEvents they produced, and the action / rule configs involved.
 * READ-ONLY. Does not mutate any rows.
 *
 * Usage (apps/api directory):
 *   npx ts-node scripts/audit-scoring.ts
 *   npx ts-node scripts/audit-scoring.ts --hours 48
 *   npx ts-node scripts/audit-scoring.ts --participantId clxxxxxx
 *   npx ts-node scripts/audit-scoring.ts --actionName מים
 *
 * Outputs four sections:
 *   1. Action configs matching the filter (or all active actions).
 *   2. Active rules per program (so you can see what threshold/bonus
 *      rules might fire on submission).
 *   3. Per-log scoring breakdown for the last N hours: each row shows
 *      the log, expected base points, and ALL ScoreEvents linked
 *      (action + rules), so you can spot inflation.
 *   4. Duplicate-detection — any (logId, groupId) pair with > 1
 *      action ScoreEvent. This is the invariant breach that would
 *      explain "score multiplied" without rules being involved.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Args {
  hours: number;
  participantId?: string;
  actionName?: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = { hours: 48 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--hours' && v) { out.hours = parseInt(v, 10); i++; }
    else if (k === '--participantId' && v) { out.participantId = v; i++; }
    else if (k === '--actionName' && v) { out.actionName = v; i++; }
  }
  return out;
}

function expectedBasePoints(action: {
  baseScoringType: string;
  points: number;
  unitSize: number | null;
  basePointsPerUnit: number | null;
}, rawValue: string): number {
  const parsed = parseFloat(rawValue);
  switch (action.baseScoringType) {
    case 'flat':
    case 'latest_value_flat':
      return action.points;
    case 'quantity_multiplier':
      if (isNaN(parsed) || parsed <= 0) return 0;
      return Math.round(action.points * parsed);
    case 'latest_value_units_delta': {
      if (!action.unitSize || action.unitSize <= 0 || action.basePointsPerUnit === null) return 0;
      const newUnits = isNaN(parsed) ? 0 : Math.floor(parsed / action.unitSize);
      // Note: priorDailyMax depends on prior submissions today — for a
      // FIRST submission of the day, priorUnits = 0 and points = newUnits * pointsPerUnit.
      return Math.max(0, newUnits * action.basePointsPerUnit);
    }
    default:
      return 0;
  }
}

async function main() {
  const args = parseArgs();
  const since = new Date(Date.now() - args.hours * 60 * 60 * 1000);

  console.log('━'.repeat(80));
  console.log(`Scoring audit — last ${args.hours}h since ${since.toISOString()}`);
  if (args.participantId) console.log(`participantId filter: ${args.participantId}`);
  if (args.actionName) console.log(`actionName filter (contains): ${args.actionName}`);
  console.log('━'.repeat(80));

  // ── 1. Action configs ────────────────────────────────────────────────────
  console.log('\n── 1. Action configs ──────────────────────────────────────');
  const actionFilter: Record<string, unknown> = { isActive: true };
  if (args.actionName) {
    actionFilter['name'] = { contains: args.actionName };
  }
  const actions = await prisma.gameAction.findMany({
    where: actionFilter,
    select: {
      id: true, name: true, programId: true,
      inputType: true, aggregationMode: true,
      baseScoringType: true, points: true,
      unitSize: true, basePointsPerUnit: true,
      maxPerDay: true,
    },
    orderBy: { name: 'asc' },
  });
  for (const a of actions) {
    console.log(`  [${a.id}] ${a.name}`);
    console.log(`     programId=${a.programId}  inputType=${a.inputType}  aggMode=${a.aggregationMode}`);
    console.log(`     baseScoringType=${a.baseScoringType}  points=${a.points}  unitSize=${a.unitSize}  basePointsPerUnit=${a.basePointsPerUnit}  maxPerDay=${a.maxPerDay}`);
  }
  if (actions.length === 0) console.log('  (none matched)');

  // ── 2. Active rules per program ──────────────────────────────────────────
  console.log('\n── 2. Active rules per program ────────────────────────────');
  const programIds = Array.from(new Set(actions.map((a) => a.programId)));
  const rules = programIds.length > 0
    ? await prisma.gameRule.findMany({
      where: { programId: { in: programIds }, isActive: true },
      select: {
        id: true, programId: true, name: true, type: true,
        conditionJson: true, rewardJson: true,
        activationType: true, activationDays: true, requiresAdminApproval: true,
      },
      orderBy: { name: 'asc' },
    })
    : [];
  for (const r of rules) {
    const cond = r.conditionJson as Record<string, unknown> | null;
    const reward = r.rewardJson as Record<string, unknown> | null;
    console.log(`  [${r.id}] ${r.name}  type=${r.type}  programId=${r.programId}`);
    console.log(`     condition=${JSON.stringify(cond)}`);
    console.log(`     reward=${JSON.stringify(reward)}  activation=${r.activationType}/${r.activationDays}  adminApproval=${r.requiresAdminApproval}`);
  }
  if (rules.length === 0) console.log('  (none for the matched programs)');

  // ── 3. Per-log breakdown ────────────────────────────────────────────────
  console.log('\n── 3. Recent UserActionLogs with their ScoreEvents ────────');
  const logFilter: Record<string, unknown> = { createdAt: { gte: since }, status: 'active' };
  if (args.participantId) logFilter['participantId'] = args.participantId;
  if (actions.length > 0 && args.actionName) {
    logFilter['actionId'] = { in: actions.map((a) => a.id) };
  }
  const logs = await prisma.userActionLog.findMany({
    where: logFilter,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      action: {
        select: {
          id: true, name: true, baseScoringType: true, points: true,
          unitSize: true, basePointsPerUnit: true,
        },
      },
      participant: { select: { firstName: true, lastName: true } },
    },
  });

  let inflatedCount = 0;
  let duplicateCount = 0;

  for (const log of logs) {
    const allSe = await prisma.scoreEvent.findMany({
      where: { logId: log.id },
      select: { id: true, sourceType: true, sourceId: true, points: true, groupId: true, parentEventId: true, metadata: true },
      orderBy: { createdAt: 'asc' },
    });
    const actionSe = allSe.filter((s) => s.sourceType === 'action');
    const ruleSe = allSe.filter((s) => s.sourceType === 'rule');
    const corrSe = allSe.filter((s) => s.sourceType === 'correction');
    const expectedBase = expectedBasePoints(log.action, log.value);
    // Sum of action points across all groups for this log.
    const actualBaseSum = actionSe.reduce((s, e) => s + e.points, 0);
    // Per-group action points (should equal expectedBase per group).
    const perGroup: Record<string, number> = {};
    for (const se of actionSe) {
      const k = se.groupId ?? '<no-group>';
      perGroup[k] = (perGroup[k] ?? 0) + se.points;
    }
    const ruleSum = ruleSe.reduce((s, e) => s + e.points, 0);
    const corrSum = corrSe.reduce((s, e) => s + e.points, 0);

    const groupKeys = Object.keys(perGroup);
    const distinctActionGroups = groupKeys.length;
    const dupGroups = groupKeys.filter((k) => actionSe.filter((s) => (s.groupId ?? '<no-group>') === k).length > 1);

    const flag: string[] = [];
    if (dupGroups.length > 0) { flag.push(`DUP(${dupGroups.length})`); duplicateCount++; }
    for (const k of groupKeys) {
      if (perGroup[k] !== expectedBase) { flag.push(`PER-GROUP-MISMATCH`); inflatedCount++; break; }
    }

    const who = `${log.participant.firstName}${log.participant.lastName ? ' ' + log.participant.lastName : ''}`;
    console.log(`\n  log=${log.id}  ${log.createdAt.toISOString()}  ${who}`);
    console.log(`    action=${log.action.name} (${log.action.baseScoringType})  value=${log.value}  expected base/group=${expectedBase}`);
    console.log(`    action SEs: total=${actionSe.length}  groups=${distinctActionGroups}  per-group=${JSON.stringify(perGroup)}  sumAcrossGroups=${actualBaseSum}`);
    if (ruleSe.length > 0) {
      console.log(`    rule SEs: count=${ruleSe.length}  sum=${ruleSum}`);
      for (const r of ruleSe) {
        const meta = r.metadata as { ruleName?: string } | null;
        console.log(`      → +${r.points}  ruleId=${r.sourceId}  name=${meta?.ruleName ?? '?'}  groupId=${r.groupId}`);
      }
    }
    if (corrSe.length > 0) {
      console.log(`    correction SEs: count=${corrSe.length}  sum=${corrSum}`);
    }
    if (flag.length > 0) console.log(`    ⚠️  ${flag.join(' · ')}`);
  }

  console.log('\n── 4. Summary ──────────────────────────────────────────────');
  console.log(`  Logs scanned: ${logs.length}`);
  console.log(`  Logs with per-group action mismatch: ${inflatedCount}`);
  console.log(`  Logs with duplicate action SEs in same group: ${duplicateCount}`);
  console.log(`\n  PER-GROUP-MISMATCH = a group's summed action points ≠ expected base. Could be`);
  console.log(`    legitimate corrections, or it could mean a duplicate action SE landed in`);
  console.log(`    the same group. Cross-check with DUP flag.`);
  console.log(`  DUP = invariant breach: more than one action SE for the same (log, group).`);
  console.log(`    The participant-portal fan-out should never produce this — investigate immediately.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
