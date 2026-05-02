import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateGroupMessageDto,
  UpdateGroupMessageDto,
  InheritFromProgramDto,
} from './dto/group-message.dto';
import { resolveTemplateScheduledAt } from './timing';

@Injectable()
export class GroupScheduledMessagesService {
  private readonly logger = new Logger(GroupScheduledMessagesService.name);
  constructor(private readonly prisma: PrismaService) {}

  list(groupId: string) {
    return this.prisma.groupScheduledMessage.findMany({
      where: { groupId },
      orderBy: [{ scheduledAt: 'asc' }],
      include: {
        // sourceTemplate is now a CommunicationTemplate. Only the fields
        // the group tab actually uses are selected.
        sourceTemplate: { select: { id: true, title: true, isActive: true } },
      },
    });
  }

  async setMasterToggle(groupId: string, enabled: boolean) {
    const g = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true },
    });
    if (!g) throw new NotFoundException('הקבוצה לא נמצאה');
    return this.prisma.group.update({
      where: { id: groupId },
      data: { scheduledMessagesEnabled: enabled },
      select: { id: true, scheduledMessagesEnabled: true },
    });
  }

  // Create a group-only message (sourceTemplateId stays null). status
  // starts as 'draft' regardless of the enabled flag — admin must
  // explicitly transition draft → pending via the enable flow.
  async create(groupId: string, dto: CreateGroupMessageDto) {
    const g = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true },
    });
    if (!g) throw new NotFoundException('הקבוצה לא נמצאה');
    return this.prisma.groupScheduledMessage.create({
      data: {
        groupId,
        sourceTemplateId: null,
        category: dto.category.trim(),
        internalName: dto.internalName.trim(),
        content: dto.content,
        scheduledAt: new Date(dto.scheduledAt),
        targetType: dto.targetType ?? 'group_whatsapp_chat',
        // Status starts as draft; if the admin set enabled=true on
        // create, we promote to pending in the same write so the
        // single-flag UX holds. They can still flip enabled off later.
        enabled: dto.enabled ?? false,
        status: dto.enabled ? 'pending' : 'draft',
      },
    });
  }

  async update(groupId: string, msgId: string, dto: UpdateGroupMessageDto) {
    const existing = await this.prisma.groupScheduledMessage.findFirst({
      where: { id: msgId, groupId },
    });
    if (!existing) throw new NotFoundException('ההודעה לא נמצאה');
    // Edits are only allowed on rows that haven't reached a terminal
    // state. An admin who wants to "redo" a sent/cancelled row creates
    // a new row from scratch.
    if (existing.status === 'sent' || existing.status === 'cancelled') {
      throw new BadRequestException('לא ניתן לערוך הודעה שכבר נשלחה או בוטלה');
    }
    // Status transitions: enabling a draft promotes it to pending.
    // Disabling does NOT change status — admin can pause a pending
    // row without losing its scheduled state. A 'failed' row can be
    // re-armed by setting enabled=true (status moves back to pending).
    let nextStatus = existing.status;
    if (dto.enabled === true) {
      if (existing.status === 'draft' || existing.status === 'failed' || existing.status === 'skipped') {
        nextStatus = 'pending';
      }
    }
    return this.prisma.groupScheduledMessage.update({
      where: { id: msgId },
      data: {
        ...(dto.category !== undefined ? { category: dto.category.trim() } : {}),
        ...(dto.internalName !== undefined ? { internalName: dto.internalName.trim() } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        ...(dto.scheduledAt !== undefined
          ? { scheduledAt: new Date(dto.scheduledAt) }
          : {}),
        ...(dto.targetType !== undefined ? { targetType: dto.targetType } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        status: nextStatus,
        // Re-arming clears prior failure state so the cron picks the
        // row up cleanly on its next tick.
        ...(nextStatus === 'pending' && existing.status !== 'pending'
          ? { attemptCount: 0, nextRetryAt: null, failureReason: null }
          : {}),
      },
    });
  }

  async cancel(groupId: string, msgId: string) {
    const existing = await this.prisma.groupScheduledMessage.findFirst({
      where: { id: msgId, groupId },
    });
    if (!existing) throw new NotFoundException('ההודעה לא נמצאה');
    if (existing.status === 'sent') {
      throw new BadRequestException('לא ניתן לבטל הודעה שכבר נשלחה');
    }
    return this.prisma.groupScheduledMessage.update({
      where: { id: msgId },
      data: { status: 'cancelled', enabled: false },
    });
  }

  // Sync missing templates — recovery flow. The PRIMARY way templates
  // become group rows is the auto-create hook on the comm-template
  // writer (programs.service.autoCreateGroupSchedulesForTemplate),
  // fired when an admin creates a new template OR adds a timingType
  // to an existing one. This endpoint stays as a manual "if anything
  // got out of sync, click here" recovery action — it's idempotent
  // thanks to @@unique(groupId, sourceTemplateId, scheduledAt).
  async syncMissingFromProgram(groupId: string, dto: InheritFromProgramDto) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, programId: true, startDate: true, endDate: true },
    });
    if (!group) throw new NotFoundException('הקבוצה לא נמצאה');
    if (!group.programId) {
      throw new BadRequestException('לא ניתן לסנכרן תבניות — הקבוצה אינה משויכת לתוכנית');
    }

    // Pull only WhatsApp comm-templates that are scheduling-default.
    // Email templates pass through because they have timingType=null.
    const templates = await this.prisma.communicationTemplate.findMany({
      where: {
        programId: group.programId,
        isActive: true,
        channel: 'whatsapp',
        timingType: { not: null },
        ...(dto.templateIds && dto.templateIds.length > 0
          ? { id: { in: dto.templateIds } }
          : {}),
      },
    });
    if (templates.length === 0) {
      return { created: 0, skipped: 0, errors: [] as { templateId: string; reason: string }[] };
    }

    let created = 0;
    let skipped = 0;
    const errors: { templateId: string; reason: string }[] = [];

    for (const t of templates) {
      let scheduledAt: Date;
      try {
        scheduledAt = resolveTemplateScheduledAt(t, group);
      } catch (e) {
        errors.push({
          templateId: t.id,
          reason: e instanceof Error ? e.message : 'תזמון לא חוקי',
        });
        continue;
      }
      try {
        const now = new Date();
        await this.prisma.groupScheduledMessage.create({
          data: {
            groupId,
            sourceTemplateId: t.id,
            category: t.category ?? '',
            internalName: t.title,
            content: t.body,
            scheduledAt,
            targetType: 'group_whatsapp_chat',
            enabled: false,
            status: 'draft',
            contentSyncedAt: now,
            scheduledAtSyncedAt: now,
          },
        });
        created++;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // Duplicate of an already-cloned (template, group, scheduledAt) —
          // the @@unique constraint did its job. Count and continue.
          skipped++;
        } else {
          throw err;
        }
      }
    }
    this.logger.log(
      `[scheduled] sync groupId=${groupId} created=${created} skipped=${skipped} errors=${errors.length}`,
    );
    return { created, skipped, errors };
  }
}
