import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChallengeTypeDto } from './dto/create-challenge-type.dto';

@Injectable()
export class ChallengeTypesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.challengeType.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  create(dto: CreateChallengeTypeDto) {
    return this.prisma.challengeType.create({
      data: {
        name: dto.name,
        description: dto.description,
        sortOrder: dto.sortOrder ?? 0,
        isActive: true,
      },
    });
  }
}
