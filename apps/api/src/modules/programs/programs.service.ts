import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { CreateProgramGroupDto } from './dto/create-program-group.dto';
import { CreateMessageTemplateDto, UpdateMessageTemplateDto } from './dto/create-message-template.dto';
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
        ...(dto.showIndividualLeaderboard !== undefined ? { showIndividualLeaderboard: dto.showIndividualLeaderboard } : {}),
        ...(dto.showGroupComparison !== undefined ? { showGroupComparison: dto.showGroupComparison } : {}),
        ...(dto.showOtherGroupsCharts !== undefined ? { showOtherGroupsCharts: dto.showOtherGroupsCharts } : {}),
        ...(dto.showOtherGroupsMemberDetails !== undefined ? { showOtherGroupsMemberDetails: dto.showOtherGroupsMemberDetails } : {}),
      },
    });
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

  // ─── Message templates ─────────────────────────────────────────────────────

  listTemplates(programId: string) {
    return this.prisma.programMessageTemplate.findMany({
      where: { programId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, content: true, createdAt: true },
    });
  }

  async createTemplate(programId: string, dto: CreateMessageTemplateDto) {
    await this.findById(programId);
    return this.prisma.programMessageTemplate.create({
      data: { programId, name: dto.name.trim(), content: dto.content.trim() },
    });
  }

  async updateTemplate(programId: string, templateId: string, dto: UpdateMessageTemplateDto) {
    const tmpl = await this.prisma.programMessageTemplate.findUnique({ where: { id: templateId } });
    if (!tmpl || tmpl.programId !== programId) throw new NotFoundException('Template not found');
    return this.prisma.programMessageTemplate.update({
      where: { id: templateId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.content !== undefined ? { content: dto.content.trim() } : {}),
      },
    });
  }

  async deleteTemplate(programId: string, templateId: string) {
    const tmpl = await this.prisma.programMessageTemplate.findUnique({ where: { id: templateId } });
    if (!tmpl || tmpl.programId !== programId) throw new NotFoundException('Template not found');
    await this.prisma.programMessageTemplate.delete({ where: { id: templateId } });
    return { ok: true };
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
