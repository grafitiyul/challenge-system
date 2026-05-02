import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappBridgeService } from '../whatsapp-bridge/whatsapp-bridge.service';
import {
  CreatePrivateScheduledMessageDto,
  UpdatePrivateScheduledMessageDto,
} from './dto/private-message.dto';
import { CLAIM_TTL_MS } from './scheduled-messages-shared';

// Service for the participant-private-DM scheduling surface. Single
// source of truth for upcoming DMs — the row is keyed on participantId
// only, never groupId, so editing/cancelling propagates to every
// surface that displays the same record.
//
// Send-now is intentionally NOT modeled here. The dedicated POST
// /send-now endpoint goes straight through WhatsappBridgeService and
// the bridge persists the outbound row to WhatsAppMessage with
// direction='outgoing'. Mirroring it here would create two sources of
// truth for "what was sent."
@Injectable()
export class PrivateScheduledMessagesService {
  private readonly logger = new Logger(PrivateScheduledMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bridge: WhatsappBridgeService,
  ) {}

  // List for the chat tab + group popup. Pending first (most useful),
  // then terminal rows newest-first for audit. The frontend filters
  // cancelled rows by default.
  list(participantId: string) {
    return this.prisma.privateScheduledMessage.findMany({
      where: { participantId },
      orderBy: [{ status: 'asc' }, { scheduledAt: 'asc' }],
    });
  }

  // Lightweight count query for the group participant-list badge —
  // returns one number per participantId in the input list. Skips
  // terminal statuses ('sent', 'failed', 'cancelled') so the badge only
  // surfaces rows that are still waiting to send.
  async countsForParticipants(
    participantIds: string[],
  ): Promise<Record<string, number>> {
    if (participantIds.length === 0) return {};
    const rows = await this.prisma.privateScheduledMessage.groupBy({
      by: ['participantId'],
      where: {
        participantId: { in: participantIds },
        status: 'pending',
      },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const r of rows) out[r.participantId] = r._count._all;
    return out;
  }

  async create(participantId: string, dto: CreatePrivateScheduledMessageDto) {
    const p = await this.prisma.participant.findUnique({
      where: { id: participantId },
      select: { id: true, isActive: true, phoneNumber: true },
    });
    if (!p) throw new NotFoundException('המשתתפת לא נמצאה');
    if (!p.isActive) throw new BadRequestException('לא ניתן לתזמן הודעה למשתתפת לא פעילה');
    if (!p.phoneNumber || !p.phoneNumber.trim()) {
      throw new BadRequestException('למשתתפת אין מספר טלפון מוגדר');
    }
    const content = dto.content?.trim() ?? '';
    if (!content) throw new BadRequestException('תוכן ההודעה הוא שדה חובה');

    const when = new Date(dto.scheduledAt);
    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException('תאריך/שעה לא תקין');
    }
    if (when.getTime() < Date.now() + 30_000) {
      // Allow a small slack so picking "now" rounded to a minute still
      // works, but reject anything clearly in the past.
      throw new BadRequestException('יש לבחור זמן עתידי');
    }

    return this.prisma.privateScheduledMessage.create({
      data: {
        participantId,
        content,
        scheduledAt: when,
        phoneSnapshot: p.phoneNumber.trim(),
        status: 'pending',
        enabled: true,
      },
    });
  }

  // Send-now passthrough. Calls the bridge directly and returns its
  // response. Outbound row is persisted by the bridge into
  // WhatsAppMessage with direction='outgoing' — which is what the chat
  // timeline endpoint reads, so the message appears in the timeline
  // automatically without us writing anywhere ourselves.
  async sendNow(participantId: string, content: string) {
    const p = await this.prisma.participant.findUnique({
      where: { id: participantId },
      select: { id: true, isActive: true, phoneNumber: true },
    });
    if (!p) throw new NotFoundException('המשתתפת לא נמצאה');
    if (!p.isActive) throw new BadRequestException('המשתתפת לא פעילה');
    if (!p.phoneNumber || !p.phoneNumber.trim()) {
      throw new BadRequestException('למשתתפת אין מספר טלפון מוגדר');
    }
    const text = content?.trim() ?? '';
    if (!text) throw new BadRequestException('תוכן ההודעה הוא שדה חובה');
    return this.bridge.sendMessage(p.phoneNumber.trim(), text);
  }

  async update(
    participantId: string,
    msgId: string,
    dto: UpdatePrivateScheduledMessageDto,
  ) {
    const existing = await this.prisma.privateScheduledMessage.findFirst({
      where: { id: msgId, participantId },
    });
    if (!existing) throw new NotFoundException('ההודעה לא נמצאה');
    if (existing.status !== 'pending') {
      throw new BadRequestException('לא ניתן לערוך הודעה שכבר נשלחה / נכשלה / בוטלה');
    }
    if (this.isClaimedNow(existing.claimedAt)) {
      throw new ConflictException('ההודעה בתהליך שליחה כעת — נסי שוב בעוד דקה');
    }

    const data: { content?: string; scheduledAt?: Date } = {};
    if (typeof dto.content === 'string') {
      const t = dto.content.trim();
      if (!t) throw new BadRequestException('תוכן ההודעה הוא שדה חובה');
      data.content = t;
    }
    if (typeof dto.scheduledAt === 'string') {
      const when = new Date(dto.scheduledAt);
      if (Number.isNaN(when.getTime())) {
        throw new BadRequestException('תאריך/שעה לא תקין');
      }
      if (when.getTime() < Date.now() + 30_000) {
        throw new BadRequestException('יש לבחור זמן עתידי');
      }
      data.scheduledAt = when;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('לא נמסרו שדות לעדכון');
    }
    return this.prisma.privateScheduledMessage.update({
      where: { id: msgId },
      data,
    });
  }

  async cancel(participantId: string, msgId: string, adminId: string | null) {
    const existing = await this.prisma.privateScheduledMessage.findFirst({
      where: { id: msgId, participantId },
    });
    if (!existing) throw new NotFoundException('ההודעה לא נמצאה');
    if (existing.status !== 'pending') {
      throw new BadRequestException('ניתן לבטל רק הודעה במצב ממתין');
    }
    if (this.isClaimedNow(existing.claimedAt)) {
      throw new ConflictException('ההודעה בתהליך שליחה כעת');
    }
    return this.prisma.privateScheduledMessage.update({
      where: { id: msgId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: adminId,
        claimedAt: null,
        claimedBy: null,
      },
    });
  }

  // The chat tab pulls inbound + outbound from WhatsAppMessage (joined
  // through the participant's private chat) and merges in the pending
  // scheduled rows. Sent rows are NOT included on this side — they
  // already appear via WhatsAppMessage with direction='outgoing'.
  async chatTimeline(participantId: string) {
    const p = await this.prisma.participant.findUnique({
      where: { id: participantId },
      select: { id: true, phoneNumber: true },
    });
    if (!p) throw new NotFoundException('המשתתפת לא נמצאה');

    const phone = (p.phoneNumber ?? '').replace(/\D/g, '');
    let messages: Awaited<ReturnType<typeof this.prisma.whatsAppMessage.findMany>> = [];
    if (phone) {
      // Resolve the participant's private WA chats by phone number. We
      // try both the digits-only normalization and the raw phoneNumber
      // because legacy chats may have either shape stored.
      const chats = await this.prisma.whatsAppChat.findMany({
        where: {
          type: 'private',
          OR: [
            { phoneNumber: phone },
            { phoneNumber: p.phoneNumber ?? undefined },
            { phoneNumber: { endsWith: phone.slice(-9) } },
          ],
        },
        select: { id: true },
      });
      const chatIds = chats.map((c) => c.id);
      if (chatIds.length > 0) {
        messages = await this.prisma.whatsAppMessage.findMany({
          where: { chatId: { in: chatIds } },
          orderBy: { timestampFromSource: 'asc' },
          // Cap the timeline so we don't blast the wire with a 5-year
          // backlog. Newest-first slice; UI presents oldest at top.
          take: 500,
        });
      }
    }

    const scheduled = await this.prisma.privateScheduledMessage.findMany({
      where: { participantId, status: { in: ['pending', 'failed', 'cancelled'] } },
      orderBy: { scheduledAt: 'asc' },
    });

    return { messages, scheduled };
  }

  private isClaimedNow(claimedAt: Date | null): boolean {
    if (!claimedAt) return false;
    return claimedAt.getTime() > Date.now() - CLAIM_TTL_MS;
  }
}
