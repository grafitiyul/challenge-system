import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { CreateGroupChatLinkDto } from './dto/create-group-chat-link.dto';

function randomAlphanumeric(length: number): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  // `includeArchived=false` (the default) preserves the historical filter so
  // existing pickers don't suddenly surface archived cohorts. The admin
  // groups list sets it to `true` — archived groups stay discoverable with
  // an "archived" chip instead of disappearing.
  //
  // "Archived" here is BOTH soft-delete (isActive=false, set by the delete
  // route's softDelete) AND status='inactive' (set by the edit UI via the
  // GroupStatus enum). Two independent fields express the same semantic;
  // both must be excluded by default or the admin/feed dropdown leaks
  // groups the admin manually marked inactive but never actually deleted.
  // This was the production bug behind "inactive groups still appear in
  // /admin/feed" — only isActive was being checked.
  findAll(challengeId?: string, includeArchived = false, includeHidden = false) {
    return this.prisma.group.findMany({
      where: {
        ...(includeArchived
          ? {}
          : {
              isActive: true,
              status: 'active',
            }),
        ...(includeHidden ? {} : { isHidden: false }),
        ...(challengeId ? { challengeId } : {}),
      },
      include: {
        challenge: true,
        program: { select: { id: true, name: true, type: true } },
        _count: { select: { participantGroups: { where: { isActive: true } } } },
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async findById(id: string) {
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: {
        challenge: true,
        program: { select: { id: true, name: true, isActive: true, type: true } },
        participantGroups: {
          where: { isActive: true },
          include: { participant: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } } },
          orderBy: { joinedAt: 'asc' },
          // accessToken included for task portal links
        },
      },
    });
    if (!group) throw new NotFoundException(`Group ${id} not found`);
    return group;
  }

  async update(id: string, dto: UpdateGroupDto) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException(`Group ${id} not found`);
    return this.prisma.group.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.startDate !== undefined ? { startDate: dto.startDate ? new Date(dto.startDate) : null } : {}),
        ...(dto.endDate !== undefined ? { endDate: dto.endDate ? new Date(dto.endDate) : null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isHidden !== undefined ? { isHidden: dto.isHidden } : {}),
        ...(dto.taskEngineEnabled !== undefined ? { taskEngineEnabled: dto.taskEngineEnabled } : {}),
        ...(dto.portalCallTime !== undefined ? { portalCallTime: dto.portalCallTime ? new Date(dto.portalCallTime) : null } : {}),
        ...(dto.portalOpenTime !== undefined ? { portalOpenTime: dto.portalOpenTime ? new Date(dto.portalOpenTime) : null } : {}),
      },
    });
  }

  async softDelete(id: string) {
    const group = await this.prisma.group.findUnique({ where: { id } });
    if (!group) throw new NotFoundException(`Group ${id} not found`);
    return this.prisma.group.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // Hard delete — only safe for groups with no participant history and
  // no references from elsewhere. Returns 400 with the first blocking
  // reason when unsafe so the admin UI can redirect to archive.
  async hardDelete(id: string) {
    const group = await this.prisma.group.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            // Count ALL memberships — not just active — because a once-
            // active member carries history even after soft-leave.
            participantGroups: true,
            messages: true,
            dailyActivities: true,
            // Game engine attachments
            scoreEvents: true,
            feedEvents: true,
            groupRuleUnlocks: true,
            // Task engine + registrations
            registrations: true,
            // Payments explicitly landed in this group
            payments: true,
          },
        },
      },
    });
    if (!group) throw new NotFoundException(`Group ${id} not found`);
    const c = group._count;
    const blockers: string[] = [];
    if (c.participantGroups) blockers.push(`${c.participantGroups} משתתפות (כולל היסטוריה)`);
    if (c.payments) blockers.push(`${c.payments} תשלומים`);
    if (c.messages) blockers.push(`${c.messages} הודעות`);
    if (c.registrations) blockers.push(`${c.registrations} רישומים`);
    if (c.scoreEvents || c.feedEvents || c.groupRuleUnlocks) {
      blockers.push('היסטוריית משחק');
    }
    if (c.dailyActivities) blockers.push(`${c.dailyActivities} פעילויות יומיות`);
    if (blockers.length > 0) {
      throw new BadRequestException(
        `לא ניתן למחוק לצמיתות: ${blockers.join(' · ')}. ניתן להעביר לארכיון במקום.`,
      );
    }
    // Also manually clear references from offers / templates that point
    // at this group — they're SET NULL in the schema, but Prisma delete
    // doesn't null them implicitly. Update to null first.
    await this.prisma.paymentOffer.updateMany({
      where: { defaultGroupId: id },
      data: { defaultGroupId: null },
    });
    await this.prisma.questionnaireTemplate.updateMany({
      where: { linkedGroupId: id },
      data: { linkedGroupId: null },
    });
    await this.prisma.groupChatLink.deleteMany({ where: { groupId: id } });
    await this.prisma.group.delete({ where: { id } });
    return { ok: true };
  }

  // Per-participant completion tracking for ONE questionnaire template
  // inside ONE group. Read-only admin visibility surface for the
  // /admin/groups/[id] questionnaires tab → "מעקב מילוי" modal.
  //
  // What "completed" means:
  //   - There exists a QuestionnaireSubmission for this (templateId,
  //     participantId) pair with status='completed' (i.e. submittedAt
  //     was stamped at finalization). Drafts do NOT count.
  //
  // Two queries, no N+1:
  //   1. active participants in this group
  //   2. submissions for those participants for this template
  // Then a JS merge picks the most-recent submission per participant
  // (preferring completed over draft, then most-recent submittedAt /
  // createdAt).
  async getQuestionnaireCompletion(groupId: string, templateId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        programId: true,
        participantGroups: {
          where: { isActive: true },
          select: {
            participant: {
              select: {
                id: true, firstName: true, lastName: true,
                phoneNumber: true, email: true,
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundException(`Group ${groupId} not found`);

    const template = await this.prisma.questionnaireTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, internalName: true, publicTitle: true, programId: true },
    });
    if (!template) throw new NotFoundException(`Questionnaire ${templateId} not found`);
    // Sanity: only allow templates that belong to this group's program.
    // Prevents the admin from URL-poking another program's template
    // through this surface.
    if (group.programId && template.programId && template.programId !== group.programId) {
      throw new BadRequestException('Questionnaire is not linked to this group\'s program');
    }

    const memberIds = group.participantGroups.map((pg) => pg.participant.id);

    const submissions = memberIds.length === 0 ? [] : await this.prisma.questionnaireSubmission.findMany({
      where: {
        templateId,
        participantId: { in: memberIds },
      },
      select: {
        id: true,
        participantId: true,
        status: true,
        submittedAt: true,
        createdAt: true,
        submittedByMode: true,
      },
      orderBy: [
        // Completed first, so the per-participant pick below picks a
        // completed submission even if a later draft exists.
        { submittedAt: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    // Per participant: prefer completed (with submittedAt), else most
    // recent draft, else null. submissions are already ordered, so the
    // first hit per participantId wins.
    const byParticipant = new Map<string, typeof submissions[number]>();
    for (const sub of submissions) {
      if (!sub.participantId) continue;
      const existing = byParticipant.get(sub.participantId);
      if (!existing) {
        byParticipant.set(sub.participantId, sub);
        continue;
      }
      // Upgrade to a completed submission if we already cached a draft.
      if (existing.status !== 'completed' && sub.status === 'completed') {
        byParticipant.set(sub.participantId, sub);
      }
    }

    const rows = group.participantGroups.map((pg) => {
      const p = pg.participant;
      const sub = byParticipant.get(p.id) ?? null;
      const hasCompleted = sub?.status === 'completed';
      return {
        participantId: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        phoneNumber: p.phoneNumber,
        email: p.email,
        hasCompleted,
        submissionId: sub?.id ?? null,
        submittedAt: sub?.submittedAt ?? null,
        status: hasCompleted ? 'completed' as const
              : sub ? 'draft' as const
              : 'none' as const,
        submittedByMode: sub?.submittedByMode ?? null,
      };
    });

    const completedCount = rows.filter((r) => r.hasCompleted).length;
    return {
      templateId: template.id,
      templateInternalName: template.internalName,
      templatePublicTitle: template.publicTitle,
      totalParticipants: rows.length,
      completedCount,
      missingCount: rows.length - completedCount,
      rows,
    };
  }

  // Returns active questionnaire templates that are linked to the same program as this group.
  // Returns empty array if the group has no program or no questionnaires are linked.
  async listQuestionnaires(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { programId: true },
    });
    if (!group) throw new NotFoundException(`Group ${groupId} not found`);
    if (!group.programId) return [];

    return this.prisma.questionnaireTemplate.findMany({
      where: { programId: group.programId, isActive: true },
      include: {
        externalLinks: {
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Add an existing participant to this group (idempotent).
  //
  // Phase 3: tokens are participant-scoped (Participant.accessToken). The
  // legacy ParticipantGroup.accessToken column stays populated for any
  // pre-migration rows but is no longer written here — moving the same
  // participant between groups never regenerates their /tg/:token link.
  async addParticipant(groupId: string, participantId: string) {
    const [group, participant] = await Promise.all([
      this.prisma.group.findUnique({ where: { id: groupId }, select: { id: true } }),
      this.prisma.participant.findUnique({
        where: { id: participantId },
        select: { id: true, accessToken: true },
      }),
    ]);
    if (!group) throw new NotFoundException(`Group ${groupId} not found`);
    if (!participant) throw new NotFoundException(`Participant ${participantId} not found`);

    await this.prisma.participantGroup.upsert({
      where: { participantId_groupId: { participantId, groupId } },
      create: { participantId, groupId },
      update: { isActive: true, leftAt: null },
    });

    // Ensure the participant has a stable portal token. Created once per
    // participant, reused on every subsequent group join.
    if (!participant.accessToken) {
      await this.ensureParticipantToken(participantId);
    }

    return this.prisma.participantGroup.findUnique({
      where: { participantId_groupId: { participantId, groupId } },
      include: { participant: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } } },
    });
  }

  // Bulk move / bulk add. Idempotent per (participant, toGroupId) pair.
  // When fromGroupId is provided, the source membership is marked
  // isActive=false (soft-leave) after the target membership is created.
  // Tokens are never regenerated.
  async bulkMove(toGroupId: string, participantIds: string[], fromGroupId?: string) {
    const toGroup = await this.prisma.group.findUnique({
      where: { id: toGroupId }, select: { id: true },
    });
    if (!toGroup) throw new NotFoundException(`Group ${toGroupId} not found`);

    const results: Array<{ participantId: string; ok: boolean; error?: string }> = [];
    for (const pid of participantIds) {
      try {
        const p = await this.prisma.participant.findUnique({
          where: { id: pid }, select: { id: true, accessToken: true },
        });
        if (!p) { results.push({ participantId: pid, ok: false, error: 'not found' }); continue; }
        await this.prisma.participantGroup.upsert({
          where: { participantId_groupId: { participantId: pid, groupId: toGroupId } },
          create: { participantId: pid, groupId: toGroupId },
          update: { isActive: true, leftAt: null },
        });
        if (fromGroupId && fromGroupId !== toGroupId) {
          await this.prisma.participantGroup.updateMany({
            where: { participantId: pid, groupId: fromGroupId },
            data: { isActive: false, leftAt: new Date() },
          });
        }
        if (!p.accessToken) await this.ensureParticipantToken(pid);
        results.push({ participantId: pid, ok: true });
      } catch (err) {
        results.push({
          participantId: pid,
          ok: false,
          error: err instanceof Error ? err.message : 'error',
        });
      }
    }
    const summary = {
      targetGroupId: toGroupId,
      moved: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
    return summary;
  }

  // Shared token ensurer — idempotent, unique across Participant.accessToken.
  async ensureParticipantToken(participantId: string): Promise<string> {
    const p = await this.prisma.participant.findUnique({
      where: { id: participantId },
      select: { accessToken: true },
    });
    if (p?.accessToken) return p.accessToken;
    let token: string;
    let attempts = 0;
    do {
      token = randomAlphanumeric(12);
      const existing = await this.prisma.participant.findUnique({
        where: { accessToken: token },
        select: { id: true },
      });
      if (!existing) break;
      attempts++;
    } while (attempts < 10);
    await this.prisma.participant.update({
      where: { id: participantId },
      data: { accessToken: token! },
    });
    return token!;
  }

  create(dto: CreateGroupDto) {
    return this.prisma.group.create({
      data: {
        name: dto.name,
        challengeId: dto.challengeId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
      },
    });
  }

  // ── Chat links ──────────────────────────────────────────────────────────────

  listChatLinks(groupId: string) {
    return this.prisma.groupChatLink.findMany({
      where: { groupId },
      include: {
        whatsappChat: true,
        participant: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  createChatLink(groupId: string, dto: CreateGroupChatLinkDto) {
    return this.prisma.groupChatLink.create({
      data: {
        groupId,
        whatsappChatId: dto.whatsappChatId,
        linkType: dto.linkType,
        participantId: dto.participantId ?? null,
      },
      include: {
        whatsappChat: true,
        participant: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
      },
    });
  }

  deleteChatLink(linkId: string) {
    return this.prisma.groupChatLink.delete({ where: { id: linkId } });
  }

  // ── Participant removal (soft-delete) ───────────────────────────────────────

  async removeParticipant(groupId: string, participantId: string) {
    const pg = await this.prisma.participantGroup.findUnique({
      where: { participantId_groupId: { participantId, groupId } },
    });
    if (!pg) throw new NotFoundException(`Participant ${participantId} not in group ${groupId}`);
    return this.prisma.participantGroup.update({
      where: { participantId_groupId: { participantId, groupId } },
      data: { isActive: false, leftAt: new Date() },
    });
  }
}
