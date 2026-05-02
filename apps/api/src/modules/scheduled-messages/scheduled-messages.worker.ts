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

// Stable identifier for THIS worker process. Useful for log-grep and
// for the success-write WHERE clause that double-checks "the row I
// claimed is still mine" before flipping status='sent'.
const WORKER_ID = makeWorkerId();

@Injectable()
export class ScheduledMessagesWorker {
  private readonly logger = new Logger(ScheduledMessagesWorker.name);
  // Module-level concurrency guard — even though @Cron prevents
  // overlapping invocations of the SAME schedule, an admin manually
  // calling tick() (e.g. from a future debug endpoint) could race.
  // Belt-and-suspenders for "at most one tick body running at a time".
  private tickInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: WhatsappBridgeService,
  ) {}

  // Runs every minute. @nestjs/schedule guarantees no overlap of the
  // same Cron — if a tick body takes >60s the next firing waits for
  // it to finish. Combined with TICK_BATCH_SIZE that's a generous
  // safety margin (5 sends × ~12s bridge timeout = 60s worst case).
  @Cron(CronExpression.EVERY_MINUTE)
  async cronTick(): Promise<void> {
    if (this.tickInFlight) {
      this.logger.warn('[scheduled] tick skipped — previous tick still running');
      return;
    }
    this.tickInFlight = true;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(
        `[scheduled] tick crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.tickInFlight = false;
    }
  }

  // Public for unit tests / future admin manual-trigger endpoint.
  async tick(): Promise<{ processed: number }> {
    const now = new Date();
    const claimCutoff = new Date(now.getTime() - CLAIM_TTL_MS);

    // 1. Find candidate ids. Filters mirror the "send rule" comment in
    //    the schema. ORDER BY scheduledAt asc so the oldest due rows
    //    go first; LIMIT TICK_BATCH_SIZE caps the work per tick.
    const candidates = await this.prisma.groupScheduledMessage.findMany({
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

      // 2. Atomic claim — UPDATE-WHERE returning the claimed row.
      //    If 0 rows were claimed (another worker won, or a flag
      //    flipped between SELECT and UPDATE), skip and move on.
      const claimed = await this.prisma.groupScheduledMessage.updateMany({
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

      // 3. Re-read with full row context for the gate checks below.
      const row = await this.prisma.groupScheduledMessage.findUnique({
        where: { id },
        include: {
          group: {
            select: {
              id: true, isActive: true, scheduledMessagesEnabled: true,
              programId: true, program: { select: { isActive: true } },
              chatLinks: {
                where: { linkType: 'group_chat' },
                select: { whatsappChat: { select: { externalChatId: true } } },
              },
            },
          },
        },
      });
      if (!row) continue;

      // 4. Gate re-validation. These checks duplicate the candidate
      //    SELECT but are necessary because:
      //      (a) the master toggle isn't part of the candidate query
      //      (b) state may have flipped between SELECT and UPDATE
      //    Failing any gate is a 'skipped' terminal — we don't retry.
      const skipReason =
        !row.group.isActive ? 'group_archived' :
        !row.group.program?.isActive ? 'program_archived' :
        !row.group.scheduledMessagesEnabled ? 'group_master_disabled' :
        null;
      if (skipReason) {
        await this.prisma.groupScheduledMessage.update({
          where: { id },
          data: {
            status: 'skipped',
            failureReason: skipReason,
            claimedAt: null, claimedBy: null,
          },
        });
        continue;
      }

      // 5. Resolve target. V1 = group_whatsapp_chat only. Without a
      //    chat link the row can't send; mark skipped so the admin
      //    sees a precise reason.
      const targetJid = row.group.chatLinks[0]?.whatsappChat?.externalChatId ?? null;
      if (!targetJid) {
        await this.prisma.groupScheduledMessage.update({
          where: { id },
          data: {
            status: 'skipped',
            failureReason: 'no_group_whatsapp_chat_link',
            claimedAt: null, claimedBy: null,
          },
        });
        continue;
      }

      // 6. Send via the existing bridge. Same code path manual admin
      //    sends use — no parallel system. The bridge throws on
      //    failure; we catch and route to retry/fail logic.
      try {
        const result = await this.bridge.sendMessage(targetJid, row.content);
        await this.prisma.groupScheduledMessage.update({
          where: { id, claimedBy: WORKER_ID },
          data: {
            status: 'sent',
            sentAt: new Date(),
            failureReason: null,
            claimedAt: null, claimedBy: null,
          },
        });
        this.logger.log(
          `[scheduled] sent id=${id} groupId=${row.groupId} externalMessageId=${result.externalMessageId}`,
        );
        processed++;
      } catch (err) {
        const reason = err instanceof Error ? err.message.split('\n')[0]?.slice(0, 240) : 'send_failed';
        const nextAttempt = row.attemptCount + 1; // already incremented in claim, but read row was pre-claim
        const isFinalAttempt = nextAttempt >= MAX_ATTEMPTS;
        const retryDelay = RETRY_DELAYS_MS[Math.min(nextAttempt - 1, RETRY_DELAYS_MS.length - 1)];
        await this.prisma.groupScheduledMessage.update({
          where: { id, claimedBy: WORKER_ID },
          data: {
            status: isFinalAttempt ? 'failed' : 'pending',
            failureReason: reason ?? 'send_failed',
            nextRetryAt: isFinalAttempt ? null : new Date(now.getTime() + retryDelay),
            claimedAt: null, claimedBy: null,
          },
        });
        this.logger.warn(
          `[scheduled] send failed id=${id} attempt=${nextAttempt}/${MAX_ATTEMPTS} ` +
          `reason=${reason} ${isFinalAttempt ? 'TERMINAL' : `nextRetryIn=${Math.round(retryDelay / 1000)}s`}`,
        );
      }

      // 7. Pace the next send. WhatsApp's spam detection notices
      //    bursts; a small inter-send delay keeps us well under any
      //    realistic threshold. Skipped after the last item so we
      //    don't waste time at the end of the batch.
      if (i < candidates.length - 1) {
        await new Promise((res) => setTimeout(res, SEND_PACING_MS));
      }
    }
    if (processed > 0) {
      this.logger.log(`[scheduled] tick complete processed=${processed}/${candidates.length}`);
    }
    return { processed };
  }
}
