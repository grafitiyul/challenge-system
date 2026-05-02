import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappBridgeService } from '../whatsapp-bridge/whatsapp-bridge.service';
import {
  CLAIM_TTL_MS,
  MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  SEND_PACING_MS,
  TICK_BATCH_SIZE,
  makeWorkerId,
} from './scheduled-messages-shared';

// Mirrors GroupScheduledMessagesWorker line-for-line in shape — same
// claim/retry/backoff invariants, same per-tick batch + pacing — but
// targets the PrivateScheduledMessage table and resolves the recipient
// via the captured phoneSnapshot rather than a group chat link.
//
// Why a sibling worker rather than a discriminator inside the existing
// one: the two domains have different terminal states ('skipped'
// reasons unique to groups, 'cancelled' unique to private), different
// candidate filters (group's master toggle vs. participant active
// flag), and different target resolution. Sharing the constants keeps
// the queueing behavior identical while letting each worker own its
// domain logic. See scheduled-messages-shared.ts.

const WORKER_ID = makeWorkerId();

@Injectable()
export class PrivateScheduledMessagesWorker {
  private readonly logger = new Logger(PrivateScheduledMessagesWorker.name);
  private tickInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: WhatsappBridgeService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cronTick(): Promise<void> {
    if (this.tickInFlight) {
      this.logger.warn('[private-scheduled] tick skipped — previous tick still running');
      return;
    }
    this.tickInFlight = true;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(
        `[private-scheduled] tick crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.tickInFlight = false;
    }
  }

  async tick(): Promise<{ processed: number }> {
    const now = new Date();
    const claimCutoff = new Date(now.getTime() - CLAIM_TTL_MS);

    // 1. Find candidate ids — pending, due, not currently claimed.
    const candidates = await this.prisma.privateScheduledMessage.findMany({
      where: {
        status: 'pending',
        enabled: true,
        scheduledAt: { lte: now },
        OR: [
          { nextRetryAt: null },
          { nextRetryAt: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { claimedAt: null },
              { claimedAt: { lt: claimCutoff } },
            ],
          },
        ],
      },
      orderBy: { scheduledAt: 'asc' },
      take: TICK_BATCH_SIZE,
      select: { id: true },
    });
    if (candidates.length === 0) return { processed: 0 };

    let processed = 0;
    for (let i = 0; i < candidates.length; i++) {
      const id = candidates[i].id;

      // 2. Atomic claim — UPDATE-WHERE returning the claimed row count.
      const claimed = await this.prisma.privateScheduledMessage.updateMany({
        where: {
          id,
          status: 'pending',
          enabled: true,
          OR: [
            { claimedAt: null },
            { claimedAt: { lt: claimCutoff } },
          ],
        },
        data: {
          claimedAt: now,
          claimedBy: WORKER_ID,
          attemptCount: { increment: 1 },
          lastAttemptAt: now,
        },
      });
      if (claimed.count === 0) continue;

      // 3. Re-read with full row context for gate checks.
      const row = await this.prisma.privateScheduledMessage.findUnique({
        where: { id },
        include: {
          participant: { select: { id: true, isActive: true, phoneNumber: true } },
        },
      });
      if (!row) continue;

      // 4. Gate re-validation. Failing any gate is terminal — these
      //    rows can't recover by retrying.
      const skipReason =
        !row.participant ? 'participant_unavailable' :
        !row.participant.isActive ? 'participant_inactive' :
        !row.phoneSnapshot ? 'phone_missing' :
        null;
      if (skipReason) {
        await this.prisma.privateScheduledMessage.update({
          where: { id },
          data: {
            status: 'failed',
            failureReason: skipReason,
            claimedAt: null,
            claimedBy: null,
          },
        });
        continue;
      }

      // 5. Send via the bridge. Same code path manual admin sends use.
      try {
        const result = await this.bridge.sendMessage(row.phoneSnapshot, row.content);
        await this.prisma.privateScheduledMessage.update({
          where: { id, claimedBy: WORKER_ID },
          data: {
            status: 'sent',
            sentAt: new Date(),
            externalMessageId: result.externalMessageId ?? null,
            failureReason: null,
            claimedAt: null,
            claimedBy: null,
          },
        });
        this.logger.log(
          `[private-scheduled] sent id=${id} participantId=${row.participantId} ` +
          `externalMessageId=${result.externalMessageId}`,
        );
        processed++;
      } catch (err) {
        const reason = err instanceof Error ? err.message.split('\n')[0]?.slice(0, 240) : 'send_failed';
        const nextAttempt = row.attemptCount + 1;
        const isFinalAttempt = nextAttempt >= MAX_ATTEMPTS;
        const retryDelay = RETRY_DELAYS_MS[Math.min(nextAttempt - 1, RETRY_DELAYS_MS.length - 1)];
        await this.prisma.privateScheduledMessage.update({
          where: { id, claimedBy: WORKER_ID },
          data: {
            status: isFinalAttempt ? 'failed' : 'pending',
            failureReason: reason ?? 'send_failed',
            nextRetryAt: isFinalAttempt ? null : new Date(now.getTime() + retryDelay),
            claimedAt: null,
            claimedBy: null,
          },
        });
        this.logger.warn(
          `[private-scheduled] send failed id=${id} attempt=${nextAttempt}/${MAX_ATTEMPTS} ` +
          `reason=${reason} ${isFinalAttempt ? 'TERMINAL' : `nextRetryIn=${Math.round(retryDelay / 1000)}s`}`,
        );
      }

      // 6. Pace the next send within the same tick.
      if (i < candidates.length - 1) {
        await new Promise((res) => setTimeout(res, SEND_PACING_MS));
      }
    }
    if (processed > 0) {
      this.logger.log(
        `[private-scheduled] tick complete processed=${processed}/${candidates.length}`,
      );
    }
    return { processed };
  }
}
