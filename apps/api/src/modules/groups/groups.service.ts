import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { CreateGroupChatLinkDto } from './dto/create-group-chat-link.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(challengeId?: string) {
    return this.prisma.group.findMany({
      where: challengeId ? { challengeId } : undefined,
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
}
