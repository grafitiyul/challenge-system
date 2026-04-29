import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { CreateProgramGroupDto } from './dto/create-program-group.dto';
import { Prisma, ProgramType } from '@prisma/client';

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
    return this.prisma.group.create({
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
      orderBy: [{ channel: 'asc' }, { title: 'asc' }],
    });
  }

  async createCommunicationTemplate(
    programId: string,
    dto: { channel: 'email' | 'whatsapp'; title: string; subject?: string | null; body: string; isActive?: boolean },
  ) {
    await this.findById(programId);
    return this.prisma.communicationTemplate.create({
      data: {
        programId,
        channel: dto.channel,
        title: dto.title.trim(),
        subject: dto.channel === 'email' ? (dto.subject ?? null) : null,
        body: dto.body,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateCommunicationTemplate(
    templateId: string,
    dto: { channel?: 'email' | 'whatsapp'; title?: string; subject?: string | null; body?: string; isActive?: boolean },
  ) {
    const existing = await this.prisma.communicationTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, channel: true },
    });
    if (!existing) throw new NotFoundException(`Template ${templateId} not found`);
    const finalChannel = dto.channel ?? existing.channel;
    return this.prisma.communicationTemplate.update({
      where: { id: templateId },
      data: {
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.subject !== undefined
          ? { subject: finalChannel === 'email' ? (dto.subject ?? null) : null }
          : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
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
