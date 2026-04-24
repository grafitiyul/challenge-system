import { Injectable, NotFoundException } from '@nestjs/common';
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

  findAll(challengeId?: string) {
    return this.prisma.group.findMany({
      where: {
        isActive: true,
        ...(challengeId ? { challengeId } : {}),
      },
      include: {
        challenge: true,
        program: { select: { id: true, name: true, type: true } },
        _count: { select: { participantGroups: { where: { isActive: true } } } },
      },
      orderBy: { createdAt: 'asc' },
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
