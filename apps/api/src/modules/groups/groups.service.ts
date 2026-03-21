import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGroupDto } from './dto/create-group.dto';

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(challengeId?: string) {
    return this.prisma.group.findMany({
      where: challengeId ? { challengeId } : undefined,
      include: { challenge: true },
      orderBy: { createdAt: 'asc' },
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
}
