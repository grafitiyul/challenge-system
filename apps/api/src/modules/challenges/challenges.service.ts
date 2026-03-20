import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';

@Injectable()
export class ChallengesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.challenge.findMany({
      include: { challengeType: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(dto: CreateChallengeDto) {
    return this.prisma.challenge.create({
      data: {
        name: dto.name,
        challengeTypeId: dto.challengeTypeId,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        isActive: dto.isActive ?? true,
      },
      include: { challengeType: true },
    });
  }
}
