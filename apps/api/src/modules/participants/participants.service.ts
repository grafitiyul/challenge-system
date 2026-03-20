import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateParticipantDto } from './dto/create-participant.dto';

@Injectable()
export class ParticipantsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByGroup(groupId: string) {
    const memberships = await this.prisma.participantGroup.findMany({
      where: { groupId, isActive: true },
      include: {
        participant: {
          include: { gender: true },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => m.participant);
  }

  async create(dto: CreateParticipantDto) {
    // Find existing participant by phone, or create new one
    let participant = await this.prisma.participant.findUnique({
      where: { phoneNumber: dto.phoneNumber },
    });

    if (!participant) {
      participant = await this.prisma.participant.create({
        data: {
          fullName: dto.fullName,
          phoneNumber: dto.phoneNumber,
          genderId: dto.genderId,
        },
      });
    }

    // Attach to group (upsert to avoid duplicates)
    await this.prisma.participantGroup.upsert({
      where: {
        participantId_groupId: {
          participantId: participant.id,
          groupId: dto.groupId,
        },
      },
      create: {
        participantId: participant.id,
        groupId: dto.groupId,
      },
      update: {
        isActive: true,
        leftAt: null,
      },
    });

    return this.prisma.participant.findUnique({
      where: { id: participant.id },
      include: { gender: true },
    });
  }
}
