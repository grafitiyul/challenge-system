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
import { renderTemplate } from '../programs/template-render';

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
  //
  // Resolving "which chats belong to this participant" combines two
  // sources:
  //   1. Direct GroupChatLink rows of type='private_participant_chat'
  //      where participantId matches. This is the explicit, admin-
  //      created link — strongest signal, never wrong.
  //   2. Phone-shape match against WhatsAppChat.phoneNumber. Catches
  //      chats that were ingested from Baileys but never linked
  //      explicitly (the common case for "the chat just works on
  //      the bridge but no one clicked link-chat yet").
  // Union of the two; dedupe by chat id. This also fixes the case
  // where the participant DOES have a private_participant_chat link
  // but the phone-pattern would have matched a different chat first
  // (or none) — explicit link always wins, then phone fallback fills
  // in the gaps.
  async chatTimeline(participantId: string) {
    const p = await this.prisma.participant.findUnique({
      where: { id: participantId },
      select: { id: true, phoneNumber: true },
    });
    if (!p) throw new NotFoundException('המשתתפת לא נמצאה');

    const chatIdSet = new Set<string>();

    // Source 1: explicit GroupChatLink rows.
    const links = await this.prisma.groupChatLink.findMany({
      where: {
        participantId,
        linkType: 'private_participant_chat',
      },
      select: { whatsappChatId: true },
    });
    for (const l of links) chatIdSet.add(l.whatsappChatId);

    // Source 2: phone-shape match. Three patterns covering both raw
    // and digits-only phone formats stored across the legacy /
    // Baileys ingest paths.
    const phone = (p.phoneNumber ?? '').replace(/\D/g, '');
    if (phone) {
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
      for (const c of chats) chatIdSet.add(c.id);
    }

    let messages: Awaited<ReturnType<typeof this.prisma.whatsAppMessage.findMany>> = [];
    if (chatIdSet.size > 0) {
      messages = await this.prisma.whatsAppMessage.findMany({
        where: { chatId: { in: Array.from(chatIdSet) } },
        orderBy: { timestampFromSource: 'asc' },
        // Cap the timeline so we don't blast the wire with a 5-year
        // backlog. Newest-first slice; UI presents oldest at top.
        take: 500,
      });
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

  // ─── Personal broadcast — group-scoped, per-participant DMs ──────────────
  //
  // Sends a single message body privately to a hand-picked subset of a
  // group's active participants. Uses the existing PrivateScheduledMessage
  // pipeline so all our safety properties carry over for free:
  //   - cron worker handles pacing (1.5s between sends, see shared consts)
  //   - retry/backoff per row
  //   - status = pending → sent / failed (visible in participant chat tab)
  //   - no double-sends (atomic claim by the worker)
  //
  // For sendMode='now' we set scheduledAt = now() so the worker picks the
  // rows up on its next tick (within ~1 minute). For sendMode='schedule'
  // we honor the provided scheduledAt as-is.
  //
  // SAFETY rule (server-enforced, NOT optional):
  //   Variables are rendered PER PARTICIPANT before persisting the row.
  //   If the renderer leaves any unresolved {variable} pattern, that
  //   participant is SKIPPED with reason='unresolved_variable'. The row
  //   is never created, so the worker can never accidentally send the
  //   raw template. Same rule for missing phone (can't send anywhere)
  //   and inactive participant.
  async privateBroadcast(
    groupId: string,
    body: {
      content: string;
      participantIds: string[];
      sendMode: 'now' | 'schedule';
      scheduledAt?: string;
    },
  ): Promise<{
    selected: number;
    queued: number;
    skipped: number;
    errors: Array<{ participantId: string; participantName: string; reason: string }>;
  }> {
    if (!body.content?.trim()) {
      throw new BadRequestException('תוכן ההודעה הוא שדה חובה');
    }
    if (!Array.isArray(body.participantIds) || body.participantIds.length === 0) {
      throw new BadRequestException('יש לבחור לפחות משתתפת אחת');
    }
    if (body.participantIds.length > 500) {
      throw new BadRequestException('יותר מדי משתתפות בבקשה אחת');
    }

    let scheduledAt = new Date();
    if (body.sendMode === 'schedule') {
      if (!body.scheduledAt) {
        throw new BadRequestException('יש לבחור תאריך/שעה לתזמון');
      }
      const when = new Date(body.scheduledAt);
      if (Number.isNaN(when.getTime())) {
        throw new BadRequestException('תאריך/שעה לא תקין');
      }
      if (when.getTime() < Date.now() + 30_000) {
        throw new BadRequestException('יש לבחור זמן עתידי');
      }
      scheduledAt = when;
    }

    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        program: { select: { id: true, name: true } },
      },
    });
    if (!group) throw new NotFoundException('הקבוצה לא נמצאה');

    // Resolve only memberships that are (a) in this group, (b) for the
    // selected participants. Filtering server-side defends against a
    // tampered client request that lists participantIds outside this
    // group.
    const memberships = await this.prisma.participantGroup.findMany({
      where: {
        groupId,
        isActive: true,
        participantId: { in: body.participantIds },
      },
      include: {
        participant: {
          select: {
            id: true, firstName: true, lastName: true,
            phoneNumber: true, email: true, isActive: true,
            accessToken: true,
          },
        },
      },
    });

    // Index memberships by participantId so the selection ordering and
    // error reporting reflect the client's input order.
    const byPid = new Map(memberships.map((m) => [m.participantId, m]));

    // Build link context once per participant — same shape as the
    // existing previewMessage flow.
    const webBaseRaw = process.env['NEXT_PUBLIC_APP_URL'] || process.env['WEB_BASE_URL'] || '';
    const webBase = webBaseRaw.replace(/\/+$/, '');

    const errors: Array<{ participantId: string; participantName: string; reason: string }> = [];
    const toCreate: Array<{
      participantId: string;
      content: string;
      phoneSnapshot: string;
    }> = [];

    for (const pid of body.participantIds) {
      const m = byPid.get(pid);
      const name = m
        ? [m.participant.firstName, m.participant.lastName].filter(Boolean).join(' ').trim()
        : pid;

      if (!m) {
        errors.push({ participantId: pid, participantName: name, reason: 'not_in_group' });
        continue;
      }
      if (!m.participant.isActive) {
        errors.push({ participantId: pid, participantName: name, reason: 'participant_inactive' });
        continue;
      }
      const phone = (m.participant.phoneNumber ?? '').trim();
      if (!phone) {
        errors.push({ participantId: pid, participantName: name, reason: 'phone_missing' });
        continue;
      }

      // Per-participant variable rendering. Same context shape as the
      // preview/send-template flow elsewhere in the codebase.
      const accessToken = m.participant.accessToken;
      const gameLink = accessToken && webBase ? `${webBase}/t/${accessToken}` : null;
      const tasksLink = accessToken && webBase ? `${webBase}/tg/${accessToken}` : null;
      const portalLink = tasksLink;
      const rendered = renderTemplate(body.content, {
        participant: {
          firstName: m.participant.firstName,
          lastName: m.participant.lastName,
          phoneNumber: phone,
          email: m.participant.email,
        },
        product: group.program ? { title: group.program.name } : null,
        group: { name: group.name },
        gameLink, tasksLink, portalLink,
      });

      // SAFETY: any {key} that survived rendering = unresolved variable.
      // We refuse to send the row to avoid leaking template syntax to
      // the participant's WhatsApp. The reason is surfaced to the admin
      // so they can fix the source template (typo, missing data, etc.).
      const unresolved = rendered.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g);
      if (unresolved && unresolved.length > 0) {
        errors.push({
          participantId: pid,
          participantName: name,
          reason: `משתנה דינמי לא הוחלף: ${Array.from(new Set(unresolved)).join(', ')}`,
        });
        continue;
      }

      toCreate.push({
        participantId: pid,
        content: rendered,
        phoneSnapshot: phone,
      });
    }

    // Bulk-create rows. createMany skips per-row return data; we don't
    // need it here — the queued count is just toCreate.length and
    // per-participant status will surface via each participant's
    // chat tab once the worker runs.
    if (toCreate.length > 0) {
      await this.prisma.privateScheduledMessage.createMany({
        data: toCreate.map((t) => ({
          participantId: t.participantId,
          content: t.content,
          scheduledAt,
          phoneSnapshot: t.phoneSnapshot,
          status: 'pending',
          enabled: true,
        })),
      });
    }

    return {
      selected: body.participantIds.length,
      queued: toCreate.length,
      skipped: errors.length,
      errors,
    };
  }
}
