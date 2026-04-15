/**
 * Shared harness for Phase 1 foundation tests.
 *
 * Each test script:
 *   1. Seeds a fresh Program, Participant, GameAction via raw Prisma calls.
 *   2. Exercises the GameEngineService against a real Postgres DB.
 *   3. Asserts invariants at the DB layer.
 *   4. Tears its own data down (deletes by program/participant scope).
 *
 * Run one by one with:
 *   npx ts-node --transpile-only apps/api/test/phase1/duplicate-submission.ts
 *
 * Run all:
 *   npm run test:phase1
 *
 * These tests write to whatever database $DATABASE_URL points at. Do NOT run
 * against production. Intended targets: local dev DB or a staging copy.
 */

import { PrismaClient } from '@prisma/client';
import { GameEngineService } from '../../src/modules/game-engine/game-engine.service';

export type Harness = {
  prisma: PrismaClient;
  service: GameEngineService;
  programId: string;
  participantId: string;
  actionId: string;
  cleanup: () => Promise<void>;
};

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `phase1_${prefix}_${Date.now()}_${counter}`;
}

export async function setupHarness(opts?: {
  maxPerDay?: number | null;
  inputType?: 'boolean' | 'number';
  aggregationMode?: 'none' | 'latest_value' | 'incremental_sum';
  points?: number;
}): Promise<Harness> {
  const prisma = new PrismaClient();

  // Create Program.
  const program = await prisma.program.create({
    data: {
      name: unique('program'),
      description: 'Phase 1 test program',
      type: 'challenge',
    },
  });

  // Create Participant (minimal required fields).
  const participant = await prisma.participant.create({
    data: {
      firstName: 'Phase1',
      lastName: unique('p'),
      phone: `+9725${Math.floor(10000000 + Math.random() * 89999999)}`,
    },
  });

  // Create GameAction.
  const action = await prisma.gameAction.create({
    data: {
      programId: program.id,
      name: unique('action'),
      inputType: opts?.inputType ?? 'boolean',
      aggregationMode: opts?.aggregationMode ?? 'none',
      points: opts?.points ?? 10,
      maxPerDay: opts?.maxPerDay ?? null,
    },
  });

  const service = new GameEngineService(prisma as never);

  const cleanup = async () => {
    await prisma.scoreEventDependency.deleteMany({
      where: { event: { participantId: participant.id } },
    });
    await prisma.feedEvent.deleteMany({ where: { participantId: participant.id } });
    await prisma.scoreEvent.deleteMany({ where: { participantId: participant.id } });
    await prisma.userActionLog.deleteMany({ where: { participantId: participant.id } });
    await prisma.gameAction.deleteMany({ where: { programId: program.id } });
    await prisma.participant.delete({ where: { id: participant.id } });
    await prisma.program.delete({ where: { id: program.id } });
    await prisma.$disconnect();
  };

  return {
    prisma,
    service,
    programId: program.id,
    participantId: participant.id,
    actionId: action.id,
    cleanup,
  };
}

export function assert(condition: unknown, msg: string): asserts condition {
  if (!condition) {
    console.error(`\u001b[31mFAIL\u001b[0m ${msg}`);
    process.exit(1);
  }
}

export function pass(msg: string): void {
  console.log(`\u001b[32mPASS\u001b[0m ${msg}`);
}
