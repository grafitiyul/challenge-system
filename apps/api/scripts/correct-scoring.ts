/**
 * Scoring correction — finds logs whose action ScoreEvents diverge from
 * the expected base points (per-group) and writes compensating
 * `correction` ScoreEvents that restore the per-group sum to truth.
 *
 * Never deletes anything. The audit trail stays intact: the original
 * (possibly inflated) action SE remains, and a new correction SE with
 * negative points and `parentEventId` pointing back to the original
 * event re-balances the ledger.
 *
 * Usage (apps/api directory):
 *   # Dry-run (default): prints what would be written.
 *   npx ts-node scripts/correct-scoring.ts --hours 48
 *
 *   # Apply: same scan, but actually inserts the correction SEs.
 *   npx ts-node scripts/correct-scoring.ts --hours 48 --apply
 *
 *   # Narrow to a specific log (handy for the two reported cases).
 *   npx ts-node scripts/correct-scoring.ts --logId clxxxxxxxxxxxxx --apply
 *
 * Idempotency: each correction is tagged with metadata
 * `{ correction: 'scoring-audit-2026-04-29' }`. On a repeat run, logs
 * with a matching correction in the same group are skipped — running
 * the script twice does NOT double-correct.
 *
 * Scope of "expected base points":
 *   - flat / latest_value_flat → action.points
 *   - quantity_multiplier      → action.points × parsed value
 *   - latest_value_units_delta → SKIPPED (its per-log attribution is
 *     resolved by the engine's chain recompute; correcting blindly
 *     would fight that path).
 *
 * Per-group invariant we restore:
 *   For each (logId, groupId) with sourceType='action':
 *     sum(ScoreEvent.points) == expectedBase
 *
 * If sum > expected, write correction = -(sum - expected) attributed
 * to the same group.
 * If sum < expected, write correction = +(expected - sum). (Rare —
 * usually the bug under-counts.)
 */

import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const CORRECTION_TAG = 'scoring-audit-2026-04-29';

interface Args {
  hours: number;
  logId?: string;
  apply: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = { hours: 48, apply: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--hours' && v) { out.hours = parseInt(v, 10); i++; }
    else if (k === '--logId' && v) { out.logId = v; i++; }
    else if (k === '--apply') { out.apply = true; }
  }
  return out;
}

function expectedBasePoints(action: {
  baseScoringType: string;
  points: number;
  unitSize: number | null;
  basePointsPerUnit: number | null;
}, rawValue: string): number | 'skip' {
  const parsed = parseFloat(rawValue);
  switch (action.baseScoringType) {
    case 'flat':
    case 'latest_value_flat':
      return action.points;
    case 'quantity_multiplier':
      if (isNaN(parsed) || parsed <= 0) return 0;
      return Math.round(action.points * parsed);
    case 'latest_value_units_delta':
      return 'skip';
    default:
      return 0;
  }
}

async function main() {
  const args = parseArgs();
  const since = new Date(Date.now() - args.hours * 60 * 60 * 1000);

  console.log('━'.repeat(80));
  console.log(`Scoring correction — apply=${args.apply}  hours=${args.hours}  since=${since.toISOString()}`);
  if (args.logId) console.log(`logId filter: ${args.logId}`);
  console.log('━'.repeat(80));

  const logFilter: Record<string, unknown> = { status: 'active' };
  if (args.logId) logFilter['id'] = args.logId;
  else logFilter['createdAt'] = { gte: since };
  const logs = await prisma.userActionLog.findMany({
    where: logFilter,
    include: {
      action: {
        select: {
          id: true, name: true, baseScoringType: true, points: true,
          unitSize: true, basePointsPerUnit: true,
        },
      },
      participant: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  let scanned = 0;
  let needCorrection = 0;
  let written = 0;
  let alreadyCorrected = 0;
  let skipped = 0;

  for (const log of logs) {
    scanned++;
    const expected = expectedBasePoints(log.action, log.value);
    if (expected === 'skip') { skipped++; continue; }

    const actionSe = await prisma.scoreEvent.findMany({
      where: { logId: log.id, sourceType: 'action' },
      select: { id: true, groupId: true, points: true },
    });
    if (actionSe.length === 0) continue;

    const perGroup: Record<string, { sum: number; firstId: string }> = {};
    for (const s of actionSe) {
      const k = s.groupId ?? '<no-group>';
      if (!perGroup[k]) perGroup[k] = { sum: 0, firstId: s.id };
      perGroup[k].sum += s.points;
    }

    for (const [groupKey, info] of Object.entries(perGroup)) {
      const delta = expected - info.sum; // positive = under, negative = over
      if (delta === 0) continue;
      needCorrection++;

      const groupId = groupKey === '<no-group>' ? null : groupKey;

      // Idempotency: skip if a correction with our tag already landed
      // for this (logId, groupId).
      const prior = await prisma.scoreEvent.findFirst({
        where: {
          logId: log.id,
          groupId,
          sourceType: 'correction',
          metadata: { path: ['correction'], equals: CORRECTION_TAG },
        },
      });
      if (prior) { alreadyCorrected++; continue; }

      const who = `${log.participant.firstName}${log.participant.lastName ? ' ' + log.participant.lastName : ''}`;
      console.log(`  log=${log.id}  ${who}  action=${log.action.name}(${log.action.baseScoringType})  value=${log.value}`);
      console.log(`    group=${groupKey}  current=${info.sum}  expected=${expected}  delta=${delta > 0 ? '+' : ''}${delta}`);

      if (!args.apply) continue;

      await prisma.scoreEvent.create({
        data: {
          participantId: log.participant.id,
          programId: log.programId,
          groupId,
          sourceType: 'correction',
          sourceId: log.actionId,
          points: delta,
          logId: log.id,
          parentEventId: info.firstId,
          metadata: {
            correction: CORRECTION_TAG,
            reason: 'inflated_action_points_per_group',
            expected,
            previousSum: info.sum,
            actionName: log.action.name,
          } as Prisma.InputJsonValue,
        },
      });
      written++;
      console.log(`    ✓ wrote correction SE  delta=${delta}`);
    }
  }

  console.log('\n── Summary ──');
  console.log(`  Logs scanned:         ${scanned}`);
  console.log(`  units-delta skipped:  ${skipped} (chain recompute owns those)`);
  console.log(`  Per-group mismatches: ${needCorrection}`);
  console.log(`  Corrections written:  ${written}${args.apply ? '' : ' (dry-run; pass --apply to commit)'}`);
  console.log(`  Already-corrected:    ${alreadyCorrected} (skipped, idempotent)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
