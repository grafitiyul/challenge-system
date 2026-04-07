import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { CreateProgramGroupDto } from './dto/create-program-group.dto';
import { ProgramType } from '@prisma/client';

@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  listAll(type?: ProgramType) {
    return this.prisma.program.findMany({
      where: {
        isActive: true,
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
    return this.prisma.program.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
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
