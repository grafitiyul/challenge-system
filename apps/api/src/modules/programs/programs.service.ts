import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { CreateProgramGroupDto } from './dto/create-program-group.dto';
import { Prisma, ProgramType } from '@prisma/client';
import {
  resolveTemplateScheduledAt,
  validateTimingFields,
  TimingType,
} from '../scheduled-messages/timing';

// Input type for CommunicationTemplate writes. Channels stay literal-
// typed because email vs whatsapp affects which fields apply (subject
// is email-only; scheduling is whatsapp-only).
export interface CommTemplateInput {
  channel: 'email' | 'whatsapp';
  title: string;
  subject?: string | null;
  body: string;
  isActive?: boolean;
  // Scheduling — all optional, only meaningful when channel='whatsapp'
  category?: string | null;
  timingType?: 'exact' | 'day_of' | 'before_start' | 'after_end' | null;
  exactAt?: string | null;
  dayOfNumber?: number | null;
  offsetDays?: number | null;
  timeOfDay?: string | null;
  sortOrder?: number;
}

export interface CommTemplateUpdateInput {
  channel?: 'email' | 'whatsapp';
  title?: string;
  subject?: string | null;
  body?: string;
  isActive?: boolean;
  category?: string | null;
  timingType?: 'exact' | 'day_of' | 'before_start' | 'after_end' | null;
  exactAt?: string | null;
  dayOfNumber?: number | null;
  offsetDays?: number | null;
  timeOfDay?: string | null;
  sortOrder?: number;
}

@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  // `includeHidden=false` (the default) removes clutter rows from the
  // main admin list. Admin flips a toggle to bring them back into view
  // without losing them.
  listAll(type?: ProgramType, includeHidden = false) {
    return this.prisma.program.findMany({
      where: {
        isActive: true,
        ...(includeHidden ? {} : { isHidden: false }),
        ...(type ? { type } : {}),
      },
      include: {
        _count: { select: { groups: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const program = await this.prisma.program.findUnique({
      where: { id },
      include: {
        groups: {
          orderBy: { createdAt: 'desc' },
          include: {
            _count: { select: { participantGroups: { where: { isActive: true } } } },
          },
        },
      },
    });
    if (!program) throw new NotFoundException(`Program ${id} not found`);
    return program;
  }

  create(dto: CreateProgramDto) {
    return this.prisma.program.create({
      data: {
        name: dto.name,
        type: dto.type,
        description: dto.description ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateProgramDto) {
    await this.findById(id);

    // Build the Prisma update payload explicitly. Fields that aren't
    // present on the DTO stay untouched. For the four catch-up text
    // fields we ALSO normalise empty strings to null at the DB layer
    // for the nullable columns — the client always sends strings, so
    // there's no ambiguity here about whether to write or not.
    const data: Prisma.ProgramUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.isHidden !== undefined) data.isHidden = dto.isHidden;
    if (dto.showIndividualLeaderboard !== undefined) data.showIndividualLeaderboard = dto.showIndividualLeaderboard;
    if (dto.showGroupComparison !== undefined) data.showGroupComparison = dto.showGroupComparison;
    if (dto.showOtherGroupsCharts !== undefined) data.showOtherGroupsCharts = dto.showOtherGroupsCharts;
    if (dto.showOtherGroupsMemberDetails !== undefined) data.showOtherGroupsMemberDetails = dto.showOtherGroupsMemberDetails;
    if (dto.rulesContent !== undefined) data.rulesContent = dto.rulesContent ?? null;
    if (dto.rulesPublished !== undefined) data.rulesPublished = dto.rulesPublished;
    if (dto.profileTabEnabled !== undefined) data.profileTabEnabled = dto.profileTabEnabled;

    // Catch-up — explicit, no spread. Each field assigned directly so
    // there's no chance of a stripped property silently turning into a
    // no-op write. Empty string → null for the three nullable columns;
    // empty buttonLabel falls back to the schema default so the UI
    // never renders a blank button label.
    if (dto.catchUpEnabled !== undefined) data.catchUpEnabled = dto.catchUpEnabled;
    if (dto.catchUpButtonLabel !== undefined) {
      const v = dto.catchUpButtonLabel.trim();
      data.catchUpButtonLabel = v === '' ? 'דיווח השלמה' : v;
    }
    if (dto.catchUpConfirmTitle !== undefined) {
      const v = dto.catchUpConfirmTitle.trim();
      data.catchUpConfirmTitle = v === '' ? null : v;
    }
    if (dto.catchUpConfirmBody !== undefined) {
      const v = dto.catchUpConfirmBody.trim();
      data.catchUpConfirmBody = v === '' ? null : v;
    }
    if (dto.catchUpDurationMinutes !== undefined) data.catchUpDurationMinutes = dto.catchUpDurationMinutes;
    if (dto.catchUpAllowedDaysBack !== undefined) data.catchUpAllowedDaysBack = dto.catchUpAllowedDaysBack;
    if (dto.catchUpBannerText !== undefined) {
      const v = dto.catchUpBannerText.trim();
      data.catchUpBannerText = v === '' ? null : v;
    }
    if (dto.catchUpAvailableDates !== undefined) {
      data.catchUpAvailableDates = Array.from(new Set(dto.catchUpAvailableDates)).sort();
    }
    if (dto.catchUpAllowedWeekdays !== undefined) {
      // Dedup + sort + clamp to valid weekday range so the column always
      // holds a canonical 0..6 list (or empty).
      data.catchUpAllowedWeekdays = Array.from(
        new Set(
          dto.catchUpAllowedWeekdays.filter(
            (n) => Number.isInteger(n) && n >= 0 && n <= 6,
          ),
        ),
      ).sort((a, b) => a - b);
    }

    return this.prisma.program.update({ where: { id }, data });
  }

  async deactivate(id: string) {
    await this.findById(id);
    return this.prisma.program.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async createGroup(programId: string, dto: CreateProgramGroupDto) {
    await this.findById(programId);
    const group = await this.prisma.group.create({
      data: {
        name: dto.name,
        programId,
        // Required legacy field — use a sentinel challenge until migration is complete
        challengeId: await this.getLegacyChallengeId(),
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        status: dto.status ?? 'active',
      },
    });
    // Auto-create draft GroupScheduledMessage rows for every active
    // scheduling template in this program. Rows are draft + disabled,
    // so nothing sends until the admin reviews and enables. Per-template
    // errors (e.g. group has no startDate but template needs it) are
    // logged inside the helper and never block group creation.
    await this.autoCreateGroupSchedulesForGroup(group.id).catch((err) => {
      // Truly defensive — the helper already swallows per-template
      // failures; this catches anything catastrophic so a comm-template
      // bug never blocks group creation. The bridge between programs
      // and scheduled-messages is best-effort.
      // eslint-disable-next-line no-console
      console.warn(
        `[scheduled] auto-create on group create groupId=${group.id} failed:`,
        err instanceof Error ? err.message : err,
      );
    });
    return group;
  }

  // Auto-create ALL scheduling templates' rows for a single group.
  // Mirror of autoCreateGroupSchedulesForTemplate (which goes the
  // other direction, fanning one template across many groups). Used
  // when a fresh group is created OR when a group's startDate / endDate
  // changes meaningfully — without this, a "day 1 reminder" template
  // wouldn't ever land in a group created after the template.
  async autoCreateGroupSchedulesForGroup(
    groupId: string,
  ): Promise<{ created: number; skipped: number; errors: { templateId: string; reason: string }[] }> {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { id: true, programId: true, isActive: true, startDate: true, endDate: true },
    });
    if (!group || !group.isActive || !group.programId) {
      return { created: 0, skipped: 0, errors: [] };
    }
    const templates = await this.prisma.communicationTemplate.findMany({
      where: {
        programId: group.programId,
        isActive: true,
        channel: 'whatsapp',
        timingType: { not: null },
      },
    });
    let created = 0;
    let skipped = 0;
    const errors: { templateId: string; reason: string }[] = [];
    for (const t of templates) {
      let scheduledAt: Date;
      try {
        scheduledAt = resolveTemplateScheduledAt(t, group);
      } catch (e) {
        errors.push({ templateId: t.id, reason: e instanceof Error ? e.message : 'תזמון לא חוקי' });
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
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          skipped++;
        } else {
          errors.push({
            templateId: t.id,
            reason: err instanceof Error ? err.message.split('\n')[0]?.slice(0, 200) ?? 'unknown' : 'unknown',
          });
        }
      }
    }
    return { created, skipped, errors };
  }

  // Hard delete — only safe when the program has no dependents. Returns a
  // first blocking reason when anything non-empty is attached, so the
  // admin UI can display exactly why and fall back to archive.
  async hardDelete(id: string) {
    const program = await this.prisma.program.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            groups: true,
            paymentOffers: true,
            waitlistEntries: true,
            questionnaireTemplates: true,
            communicationTemplates: true,
            gameActions: true,
            gameRules: true,
            scoreEvents: true,
            userActionLogs: true,
            participantGameStates: true,
            feedEvents: true,
          },
        },
      },
    });
    if (!program) throw new NotFoundException(`Program ${id} not found`);
    const c = program._count;
    const blockers: string[] = [];
    if (c.groups) blockers.push(`${c.groups} קבוצות משויכות`);
    if (c.paymentOffers) blockers.push(`${c.paymentOffers} הצעות מכר`);
    if (c.waitlistEntries) blockers.push(`${c.waitlistEntries} רשומות ברשימת המתנה`);
    if (c.questionnaireTemplates) blockers.push(`${c.questionnaireTemplates} שאלונים משויכים`);
    if (c.communicationTemplates) blockers.push(`${c.communicationTemplates} נוסחי הודעה`);
    if (c.gameActions) blockers.push(`${c.gameActions} פעולות משחק`);
    if (c.gameRules) blockers.push(`${c.gameRules} חוקי משחק`);
    if (c.scoreEvents || c.userActionLogs || c.participantGameStates || c.feedEvents) {
      blockers.push('היסטוריית משחק/ניקוד');
    }
    if (blockers.length > 0) {
      throw new BadRequestException(
        `לא ניתן למחוק לצמיתות: ${blockers.join(' · ')}. ניתן להעביר לארכיון במקום.`,
      );
    }
    await this.prisma.program.delete({ where: { id } });
    return { ok: true };
  }

  // ─── Program = Product: waitlist / offers / communication templates ────────
  //
  // Phase 4 collapsed the standalone Product entity onto Program. These
  // methods expose the product-side surfaces (what's on the waitlist,
  // which offers are selling this product, which email/WhatsApp
  // templates belong to this product) so the admin UI can live inside
  // /admin/programs/:id instead of a parallel /admin/products screen.

  async listWaitlist(programId: string) {
    await this.findById(programId);
    return this.prisma.programWaitlistEntry.findMany({
      where: { programId, isActive: true },
      include: {
        participant: {
          select: {
            id: true, firstName: true, lastName: true,
            phoneNumber: true, email: true, status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addWaitlist(programId: string, dto: { participantId: string; source?: string | null; notes?: string | null }) {
    await this.findById(programId);
    return this.prisma.programWaitlistEntry.upsert({
      where: { programId_participantId: { programId, participantId: dto.participantId } },
      create: {
        programId,
        participantId: dto.participantId,
        source: dto.source ?? null,
        notes: dto.notes ?? null,
      },
      update: {
        isActive: true,
        ...(dto.source !== undefined ? { source: dto.source ?? null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes ?? null } : {}),
      },
    });
  }

  async removeWaitlist(programId: string, participantId: string) {
    await this.findById(programId);
    return this.prisma.programWaitlistEntry.update({
      where: { programId_participantId: { programId, participantId } },
      data: { isActive: false },
    });
  }

  async listOffers(programId: string) {
    await this.findById(programId);
    return this.prisma.paymentOffer.findMany({
      where: { linkedProgramId: programId },
      include: {
        defaultGroup: { select: { id: true, name: true } },
        _count: { select: { payments: true } },
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  // ── Communication templates (email / whatsapp, with variables) ────────────

  async listCommunicationTemplates(programId: string, channel?: string) {
    await this.findById(programId);
    return this.prisma.communicationTemplate.findMany({
      where: {
        programId,
        isActive: true,
        ...(channel ? { channel } : {}),
      },
      orderBy: [{ channel: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }],
    });
  }

  async createCommunicationTemplate(
    programId: string,
    dto: CommTemplateInput,
  ) {
    await this.findById(programId);
    if (dto.timingType) {
      validateTimingFields(dto.timingType as TimingType, dto);
    }
    const created = await this.prisma.communicationTemplate.create({
      data: {
        programId,
        channel: dto.channel,
        title: dto.title.trim(),
        subject: dto.channel === 'email' ? (dto.subject ?? null) : null,
        body: dto.body,
        isActive: dto.isActive ?? true,
        // Scheduling defaults — only meaningful for whatsapp templates.
        // Email templates pass through with timingType=null.
        category: dto.category?.trim() || null,
        ...this.normaliseTimingForWrite(dto),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    // Fan out to every existing group of this program if the template
    // has scheduling defaults. Hook is fire-and-forget at the API
    // contract level — the create response returns immediately and
    // the auto-create runs synchronously inside the same request so
    // a rapid second call sees the created rows. Errors per-group
    // are isolated and logged; the create itself never fails because
    // a single group's date math went wrong.
    if (created.channel === 'whatsapp' && created.timingType) {
      await this.autoCreateGroupSchedulesForTemplate(created.id);
    }
    return created;
  }

  async updateCommunicationTemplate(
    templateId: string,
    dto: CommTemplateUpdateInput,
  ) {
    const existing = await this.prisma.communicationTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, channel: true, timingType: true },
    });
    if (!existing) throw new NotFoundException(`Template ${templateId} not found`);
    const finalChannel = dto.channel ?? existing.channel;
    // Compute the resulting timingType to know which timing fields to
    // validate + persist. Sending null on `timingType` clears scheduling.
    const nextTimingType =
      dto.timingType !== undefined ? dto.timingType : existing.timingType;
    if (dto.timingType !== undefined && dto.timingType !== null) {
      validateTimingFields(dto.timingType as TimingType, {
        exactAt: dto.exactAt ?? null,
        dayOfNumber: dto.dayOfNumber ?? null,
        offsetDays: dto.offsetDays ?? null,
        timeOfDay: dto.timeOfDay ?? null,
      });
    }
    const updated = await this.prisma.communicationTemplate.update({
      where: { id: templateId },
      data: {
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.subject !== undefined
          ? { subject: finalChannel === 'email' ? (dto.subject ?? null) : null }
          : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.category !== undefined ? { category: dto.category?.trim() || null } : {}),
        ...(dto.timingType !== undefined ? { timingType: dto.timingType } : {}),
        ...this.normaliseTimingForWrite({
          timingType: nextTimingType ?? null,
          exactAt: dto.exactAt,
          dayOfNumber: dto.dayOfNumber,
          offsetDays: dto.offsetDays,
          timeOfDay: dto.timeOfDay,
        }, /* onlyWhenSet= */ true),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
    });
    // If THIS update added scheduling for the first time (existing
    // had no timingType, new one does), fan out to existing groups.
    // Subsequent edits to a scheduling template do NOT re-fan; the
    // admin uses the explicit "apply to groups" flow to push edits.
    if (
      updated.channel === 'whatsapp' &&
      updated.timingType &&
      !existing.timingType
    ) {
      await this.autoCreateGroupSchedulesForTemplate(updated.id);
    }
    return updated;
  }

  async deactivateCommunicationTemplate(templateId: string) {
    const existing = await this.prisma.communicationTemplate.findUnique({
      where: { id: templateId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Template ${templateId} not found`);
    return this.prisma.communicationTemplate.update({
      where: { id: templateId },
      data: { isActive: false },
    });
  }

  // Drag-and-drop reorder. Body is [{ id, sortOrder }, ...] one row per
  // template. All ids must belong to this program — the WHERE clause
  // enforces it server-side so a malicious payload can't reorder
  // someone else's templates.
  async reorderCommunicationTemplates(
    programId: string,
    items: { id: string; sortOrder: number }[],
  ) {
    await this.findById(programId);
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.communicationTemplate.update({
          where: { id: item.id, programId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
    return { ok: true as const };
  }

  // Auto-create draft GroupScheduledMessage rows for every existing
  // group of the template's program. Idempotent thanks to the
  // @@unique(groupId, sourceTemplateId, scheduledAt) constraint —
  // re-running just no-ops on rows that already exist.
  // Per-group errors (e.g. group missing startDate for a 'day_of'
  // template) are logged and skipped; one bad group never blocks
  // the others.
  async autoCreateGroupSchedulesForTemplate(
    templateId: string,
  ): Promise<{ created: number; skipped: number; errors: { groupId: string; reason: string }[] }> {
    const tpl = await this.prisma.communicationTemplate.findUnique({
      where: { id: templateId },
    });
    if (!tpl || tpl.channel !== 'whatsapp' || !tpl.timingType || !tpl.isActive) {
      return { created: 0, skipped: 0, errors: [] };
    }
    const groups = await this.prisma.group.findMany({
      where: { programId: tpl.programId, isActive: true },
      select: { id: true, startDate: true, endDate: true },
    });
    let created = 0;
    let skipped = 0;
    const errors: { groupId: string; reason: string }[] = [];
    for (const g of groups) {
      let scheduledAt: Date;
      try {
        scheduledAt = resolveTemplateScheduledAt(tpl, g);
      } catch (e) {
        errors.push({ groupId: g.id, reason: e instanceof Error ? e.message : 'תזמון לא חוקי' });
        continue;
      }
      try {
        const now = new Date();
        await this.prisma.groupScheduledMessage.create({
          data: {
            groupId: g.id,
            sourceTemplateId: tpl.id,
            category: tpl.category ?? '',
            internalName: tpl.title,
            content: tpl.body,
            scheduledAt,
            targetType: 'group_whatsapp_chat',
            // Auto-create rule: always start as draft + disabled. The
            // admin must explicitly enable each row. No row ever sends
            // without an admin action.
            enabled: false,
            status: 'draft',
            // Track sync timestamps so the apply-to-groups flow can
            // detect manual edits later.
            contentSyncedAt: now,
            scheduledAtSyncedAt: now,
          },
        });
        created++;
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // Already exists for this (group, template, scheduledAt) —
          // expected on re-runs. Count as skipped, not error.
          skipped++;
        } else {
          errors.push({
            groupId: g.id,
            reason: err instanceof Error ? err.message.split('\n')[0]?.slice(0, 200) ?? 'unknown' : 'unknown',
          });
        }
      }
    }
    return { created, skipped, errors };
  }

  // Apply changes to selected groups — explicit, never silent.
  // Looks up the existing group row by sourceTemplateId, refreshes
  // content + scheduledAt from the template snapshot, and stamps
  // sync timestamps. SKIPS:
  //   * rows in terminal status (sent / cancelled)
  //   * rows where the admin edited content/scheduledAt manually
  //     since the last sync — UNLESS opts.overrideManualEdits=true
  //
  // Returns per-group outcome so the UI can show a clear summary.
  async applyTemplateChangesToGroups(
    templateId: string,
    groupIds: string[],
    opts: { overrideManualEdits?: boolean } = {},
  ): Promise<{
    updated: string[];
    skippedTerminal: string[];
    skippedManual: string[];
    skippedMissing: string[];
    errors: { groupId: string; reason: string }[];
  }> {
    const tpl = await this.prisma.communicationTemplate.findUnique({
      where: { id: templateId },
    });
    if (!tpl) throw new NotFoundException(`Template ${templateId} not found`);
    if (!tpl.timingType) {
      throw new BadRequestException('התבנית אינה תבנית תזמון');
    }
    const updated: string[] = [];
    const skippedTerminal: string[] = [];
    const skippedManual: string[] = [];
    const skippedMissing: string[] = [];
    const errors: { groupId: string; reason: string }[] = [];

    for (const groupId of groupIds) {
      const row = await this.prisma.groupScheduledMessage.findFirst({
        where: { groupId, sourceTemplateId: templateId },
      });
      if (!row) {
        skippedMissing.push(groupId);
        continue;
      }
      if (row.status === 'sent' || row.status === 'cancelled') {
        skippedTerminal.push(groupId);
        continue;
      }
      // Manual-edit detection. updatedAt > contentSyncedAt means a
      // direct admin edit on the group row happened after the most
      // recent sync. Same for scheduledAtSyncedAt. We compare to the
      // LATER of the two sync timestamps — being conservative.
      const lastSync = row.contentSyncedAt && row.scheduledAtSyncedAt
        ? Math.max(row.contentSyncedAt.getTime(), row.scheduledAtSyncedAt.getTime())
        : (row.contentSyncedAt ?? row.scheduledAtSyncedAt)?.getTime() ?? 0;
      const isManuallyEdited = row.updatedAt.getTime() > lastSync + 500; // 500ms slack for sync write itself
      if (isManuallyEdited && !opts.overrideManualEdits) {
        skippedManual.push(groupId);
        continue;
      }
      const group = await this.prisma.group.findUnique({
        where: { id: groupId },
        select: { startDate: true, endDate: true },
      });
      if (!group) {
        skippedMissing.push(groupId);
        continue;
      }
      let nextScheduledAt: Date;
      try {
        nextScheduledAt = resolveTemplateScheduledAt(tpl, group);
      } catch (e) {
        errors.push({ groupId, reason: e instanceof Error ? e.message : 'תזמון לא חוקי' });
        continue;
      }
      const now = new Date();
      try {
        await this.prisma.groupScheduledMessage.update({
          where: { id: row.id },
          data: {
            content: tpl.body,
            internalName: tpl.title,
            category: tpl.category ?? '',
            scheduledAt: nextScheduledAt,
            contentSyncedAt: now,
            scheduledAtSyncedAt: now,
            // Re-arming: if the row had landed in 'failed' or 'skipped'
            // due to old content/timing, reset the retry state and
            // bring it back to 'pending' (only if it was enabled
            // and the new time is in the future). Don't auto-flip
            // enabled — that's a separate admin decision.
            ...(row.status === 'failed' || row.status === 'skipped'
              ? { status: 'pending', attemptCount: 0, nextRetryAt: null, failureReason: null }
              : {}),
          },
        });
        updated.push(groupId);
      } catch (err) {
        errors.push({
          groupId,
          reason: err instanceof Error ? err.message.split('\n')[0]?.slice(0, 200) ?? 'unknown' : 'unknown',
        });
      }
    }
    return { updated, skippedTerminal, skippedManual, skippedMissing, errors };
  }

  // Internal: list of groups using this template, with per-group manual-
  // edit indicator. Powers the apply-to-groups modal so the admin sees
  // which rows have local edits before pressing the button.
  async listGroupsUsingTemplate(templateId: string): Promise<Array<{
    groupId: string;
    groupName: string;
    groupIsActive: boolean;
    rowStatus: string;
    rowEnabled: boolean;
    isManuallyEdited: boolean;
  }>> {
    const rows = await this.prisma.groupScheduledMessage.findMany({
      where: { sourceTemplateId: templateId },
      include: {
        group: { select: { id: true, name: true, isActive: true } },
      },
    });
    return rows.map((row) => {
      const lastSync = row.contentSyncedAt && row.scheduledAtSyncedAt
        ? Math.max(row.contentSyncedAt.getTime(), row.scheduledAtSyncedAt.getTime())
        : (row.contentSyncedAt ?? row.scheduledAtSyncedAt)?.getTime() ?? 0;
      const isManuallyEdited = row.updatedAt.getTime() > lastSync + 500;
      return {
        groupId: row.group.id,
        groupName: row.group.name,
        groupIsActive: row.group.isActive,
        rowStatus: row.status,
        rowEnabled: row.enabled,
        isManuallyEdited,
      };
    });
  }

  // Persist only the timing columns relevant to the picked timingType.
  // Switching modes clears the stale columns so a 'day_of' → 'exact'
  // edit doesn't leave a dangling dayOfNumber.
  // When `onlyWhenSet=true`, fields the DTO didn't touch are left alone
  // (used by update); otherwise zeros/clears the irrelevant ones.
  private normaliseTimingForWrite(
    src: {
      timingType?: string | null;
      exactAt?: string | Date | null;
      dayOfNumber?: number | null;
      offsetDays?: number | null;
      timeOfDay?: string | null;
    },
    onlyWhenSet = false,
  ): Record<string, unknown> {
    const t = src.timingType;
    const out: Record<string, unknown> = {};
    if (!t) {
      // Clearing scheduling — null every mode-specific column too.
      if (!onlyWhenSet) {
        out.exactAt = null;
        out.dayOfNumber = null;
        out.offsetDays = null;
        out.timeOfDay = null;
      } else {
        // On update with no timingType change, leave existing values.
      }
      return out;
    }
    if (t === 'exact') {
      out.exactAt = src.exactAt ? new Date(src.exactAt as string) : null;
      out.dayOfNumber = null;
      out.offsetDays = null;
      out.timeOfDay = null;
    } else if (t === 'day_of') {
      out.exactAt = null;
      out.dayOfNumber = src.dayOfNumber ?? null;
      out.offsetDays = null;
      out.timeOfDay = src.timeOfDay ?? null;
    } else if (t === 'before_start' || t === 'after_end') {
      out.exactAt = null;
      out.dayOfNumber = null;
      out.offsetDays = src.offsetDays ?? null;
      out.timeOfDay = src.timeOfDay ?? null;
    }
    return out;
  }

  // ── Groups (active + archived) referenced by the program ─────────────────
  // Unifies groups linked through offers/questionnaires/program.groups so
  // the admin sees a single list inside the program page.
  //
  // `includeHidden=false` (default) excludes groups with isHidden=true —
  // same clutter-filter semantics as /admin/groups. Admin flips a toggle
  // on the Groups tab to include them.
  async listRelatedGroups(programId: string, includeHidden = false) {
    await this.findById(programId);
    const [direct, offers, templates] = await Promise.all([
      this.prisma.group.findMany({
        where: {
          programId,
          ...(includeHidden ? {} : { isHidden: false }),
        },
        include: {
          challenge: { select: { id: true, name: true } },
          _count: { select: { participantGroups: { where: { isActive: true } } } },
        },
      }),
      this.prisma.paymentOffer.findMany({
        where: { linkedProgramId: programId },
        select: {
          id: true, title: true, isActive: true,
          defaultGroup: {
            include: {
              challenge: { select: { id: true, name: true } },
              _count: { select: { participantGroups: { where: { isActive: true } } } },
            },
          },
        },
      }),
      this.prisma.questionnaireTemplate.findMany({
        where: { programId },
        select: {
          id: true, internalName: true,
          linkedGroup: {
            include: {
              challenge: { select: { id: true, name: true } },
              _count: { select: { participantGroups: { where: { isActive: true } } } },
            },
          },
        },
      }),
    ]);

    type Row = { id: string; name: string; isActive: boolean; isHidden: boolean;
      challenge: { id: string; name: string } | null;
      _count: { participantGroups: number };
    };
    const byId = new Map<string, { group: Row; reasons: string[] }>();
    const skipHidden = (g: { isHidden: boolean } | null | undefined) =>
      !includeHidden && !!g?.isHidden;
    for (const g of direct) {
      if (skipHidden(g)) continue;
      const entry = byId.get(g.id) ?? { group: g as unknown as Row, reasons: [] };
      entry.reasons.push('קבוצה של התוכנית');
      byId.set(g.id, entry);
    }
    for (const o of offers) {
      if (!o.defaultGroup || skipHidden(o.defaultGroup)) continue;
      const entry = byId.get(o.defaultGroup.id) ?? { group: o.defaultGroup as unknown as Row, reasons: [] };
      entry.reasons.push(`הצעה: ${o.title}`);
      byId.set(o.defaultGroup.id, entry);
    }
    for (const t of templates) {
      if (!t.linkedGroup || skipHidden(t.linkedGroup)) continue;
      const entry = byId.get(t.linkedGroup.id) ?? { group: t.linkedGroup as unknown as Row, reasons: [] };
      entry.reasons.push(`שאלון: ${t.internalName}`);
      byId.set(t.linkedGroup.id, entry);
    }
    return Array.from(byId.values()).map(({ group, reasons }) => ({
      id: group.id,
      name: group.name,
      isActive: group.isActive,
      isHidden: group.isHidden,
      challenge: group.challenge,
      activeMembers: group._count.participantGroups,
      reasons,
    }));
  }

  // Returns a stable sentinel challengeId for program-owned groups.
  // Creates a legacy "Programs" challenge entry once if it doesn't exist.
  private async getLegacyChallengeId(): Promise<string> {
    const LEGACY_NAME = '__programs_legacy__';
    let legacy = await this.prisma.challenge.findFirst({ where: { name: LEGACY_NAME } });
    if (!legacy) {
      // Need a challengeType — get any or create one
      let type = await this.prisma.challengeType.findFirst();
      if (!type) {
        type = await this.prisma.challengeType.create({ data: { name: 'General' } });
      }
      legacy = await this.prisma.challenge.create({
        data: {
          name: LEGACY_NAME,
          challengeTypeId: type.id,
          startDate: new Date(),
          endDate: new Date(),
          isActive: false,
        },
      });
    }
    return legacy.id;
  }
}
