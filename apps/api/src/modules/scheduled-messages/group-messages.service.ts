import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateGroupMessageDto,
  UpdateGroupMessageDto,
  InheritFromProgramDto,
} from './dto/group-message.dto';

const PARTICIPANT_TZ = 'Asia/Jerusalem';

// Compose an absolute UTC Date from a YYYY-MM-DD calendar day (in
// Asia/Jerusalem) plus an HH:mm wall-clock time. Robust against DST
// transitions because we anchor on the local calendar day and then
// normalise via Intl. Used by the template→group timing resolver.
function jerusalemDateAtTime(ymd: string, hhmm: string): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  // Probe: a UTC noon on the target Y/M/D guarantees we're on the
  // correct local day in Asia/Jerusalem regardless of DST. Then
  // shift to the desired hours/minutes by computing the offset
  // between UTC noon and the local target wall-clock.
  const [y, m, d] = ymd.split('-').map(Number);
  // Build the local-time string and let Date parse it via toLocaleString
  // round-trip; cheaper to compute the offset directly:
  const probe = new Date(Date.UTC(y, (m as number) - 1, d, 12, 0, 0));
  const localParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARTICIPANT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(probe);
  const localHour = Number(localParts.find((p) => p.type === 'hour')?.value);
  // If the probe's local time is 14:00 on this day, the offset from
  // UTC noon to local noon is +2 hours; we use that to shift to
  // the desired wall-clock.
  const offsetHours = localHour - 12;
  return new Date(Date.UTC(y, (m as number) - 1, d, hh - offsetHours, mm, 0));
}

// Format a Date as YYYY-MM-DD using its Asia/Jerusalem calendar day.
function jerusalemYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PARTICIPANT_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// Add `days` to a YYYY-MM-DD calendar day, returning YYYY-MM-DD.
function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m as number) - 1, d + days));
  return jerusalemYmd(dt);
}

// Resolve a template's timingType + offsets + the group's start/end
// dates into a single absolute UTC instant. Throws BadRequestException
// when the group lacks the date the timing type depends on.
export function resolveTemplateScheduledAt(
  template: {
    timingType: string;
    exactAt: Date | null;
    dayOfNumber: number | null;
    offsetDays: number | null;
    timeOfDay: string | null;
  },
  group: { startDate: Date | null; endDate: Date | null },
): Date {
  switch (template.timingType) {
    case 'exact': {
      if (!template.exactAt) {
        throw new BadRequestException('תבנית "תאריך מדויק" ללא תאריך מוגדר');
      }
      return template.exactAt;
    }
    case 'day_of': {
      if (!group.startDate) {
        throw new BadRequestException('לא ניתן לייבא תבנית "יום N של המשחק" לקבוצה ללא תאריך התחלה');
      }
      if (!template.dayOfNumber || !template.timeOfDay) {
        throw new BadRequestException('תבנית "יום N של המשחק" חסרה מספר יום או שעה');
      }
      const startYmd = jerusalemYmd(group.startDate);
      const targetYmd = addDaysYmd(startYmd, template.dayOfNumber - 1);
      return jerusalemDateAtTime(targetYmd, template.timeOfDay);
    }
    case 'before_start': {
      if (!group.startDate) {
        throw new BadRequestException('לא ניתן לייבא תבנית "X ימים לפני התחלה" לקבוצה ללא תאריך התחלה');
      }
      if (template.offsetDays === null || !template.timeOfDay) {
        throw new BadRequestException('תבנית "X ימים לפני התחלה" חסרה מספר ימים או שעה');
      }
      const startYmd = jerusalemYmd(group.startDate);
      const targetYmd = addDaysYmd(startYmd, -template.offsetDays);
      return jerusalemDateAtTime(targetYmd, template.timeOfDay);
    }
    case 'after_end': {
      if (!group.endDate) {
        throw new BadRequestException('לא ניתן לייבא תבנית "X ימים אחרי סיום" לקבוצה ללא תאריך סיום');
      }
      if (template.offsetDays === null || !template.timeOfDay) {
        throw new BadRequestException('תבנית "X ימים אחרי סיום" חסרה מספר ימים או שעה');
      }
      const endYmd = jerusalemYmd(group.endDate);
      const targetYmd = addDaysYmd(endYmd, template.offsetDays);
      return jerusalemDateAtTime(targetYmd, template.timeOfDay);
    }
    default:
      throw new BadRequestException(`timingType לא נתמך: ${template.timingType}`);
  }
}

@Injectable()
export class GroupScheduledMessagesService {
  private readonly logger = new Logger(GroupScheduledMessagesService.name);
  constructor(private readonly prisma: PrismaService) {}

  list(groupId: string) {
    return this.prisma.groupScheduledMessage.findMany({
      where: { groupId },
      orderBy: [{ scheduledAt: 'asc' }],
      include: {
        sourceTemplate: { select: { id: true, internalName: true, isActive: true } },
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

  // Inherit (clone) program templates into this group. Each template
  // becomes a fresh GroupScheduledMessage row with status='draft' and
  // enabled=false — admin must explicitly approve. Skips templates
  // that would produce a duplicate via @@unique(groupId, sourceTemplateId, scheduledAt).
  async inheritFromProgram(groupId: string, dto: InheritFromProgramDto) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, programId: true, startDate: true, endDate: true },
    });
    if (!group) throw new NotFoundException('הקבוצה לא נמצאה');
    if (!group.programId) {
      throw new BadRequestException('לא ניתן לייבא תבניות — הקבוצה אינה משויכת לתוכנית');
    }

    const where = {
      programId: group.programId,
      isActive: true,
      ...(dto.templateIds && dto.templateIds.length > 0
        ? { id: { in: dto.templateIds } }
        : {}),
    };
    const templates = await this.prisma.programScheduledMessageTemplate.findMany({ where });
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
        await this.prisma.groupScheduledMessage.create({
          data: {
            groupId,
            sourceTemplateId: t.id,
            category: t.category,
            internalName: t.internalName,
            content: t.content,
            scheduledAt,
            targetType: 'group_whatsapp_chat',
            enabled: false,
            status: 'draft',
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
      `[scheduled] inherit groupId=${groupId} created=${created} skipped=${skipped} errors=${errors.length}`,
    );
    return { created, skipped, errors };
  }
}
