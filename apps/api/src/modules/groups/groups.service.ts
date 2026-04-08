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
  // Also ensures the participant has an access token for the portal.
  async addParticipant(groupId: string, participantId: string) {
    const [group, participant] = await Promise.all([
      this.prisma.group.findUnique({ where: { id: groupId }, select: { id: true } }),
      this.prisma.participant.findUnique({ where: { id: participantId }, select: { id: true } }),
    ]);
    if (!group) throw new NotFoundException(`Group ${groupId} not found`);
    if (!participant) throw new NotFoundException(`Participant ${participantId} not found`);

    // Upsert the membership
    const pg = await this.prisma.participantGroup.upsert({
      where: { participantId_groupId: { participantId, groupId } },
      create: { participantId, groupId },
      update: { isActive: true, leftAt: null },
    });

    // Ensure an access token exists
    if (!pg.accessToken) {
      let token: string;
      let attempts = 0;
      do {
        token = randomAlphanumeric(12);
        const existing = await this.prisma.participantGroup.findUnique({ where: { accessToken: token } });
        if (!existing) break;
        attempts++;
      } while (attempts < 10);

      await this.prisma.participantGroup.update({
        where: { participantId_groupId: { participantId, groupId } },
        data: { accessToken: token! },
      });
    }

    return this.prisma.participantGroup.findUnique({
      where: { participantId_groupId: { participantId, groupId } },
      include: { participant: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } } },
    });
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
