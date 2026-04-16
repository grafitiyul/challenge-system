import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateAnalyticsGroupDto,
  UpdateAnalyticsGroupDto,
} from './dto/analytics-group.dto';

/**
 * Phase 4.3 — Centralized analytics groups.
 *
 * One row per admin-authored presentation group, scoped to a program.
 * Context definitions point at a group via ContextDefinition.analyticsGroupId;
 * multiple definitions sharing a group aggregate together in the participant
 * analytics UI.
 *
 * Label is unique per program so admins can't create two "תזונה" entries.
 * Deletion is refused when a group is still in use — admins must detach
 * contexts first (or leave the group be; empty groups are harmless).
 */
@Injectable()
export class AnalyticsGroupService {
  constructor(private readonly prisma: PrismaService) {}

  async list(programId: string) {
    const rows = await this.prisma.analyticsGroup.findMany({
      where: { programId },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      include: {
        _count: { select: { definitions: true } },
      },
    });
    return rows.map((g) => ({
      id: g.id,
      label: g.label,
      sortOrder: g.sortOrder,
      memberCount: g._count.definitions,
    }));
  }

  async get(id: string) {
    const row = await this.prisma.analyticsGroup.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Analytics group ${id} not found`);
    return row;
  }

  async create(programId: string, dto: CreateAnalyticsGroupDto) {
    const label = dto.label?.trim();
    if (!label) throw new BadRequestException('Label is required');
    const count = await this.prisma.analyticsGroup.count({ where: { programId } });
    try {
      return await this.prisma.analyticsGroup.create({
        data: { programId, label, sortOrder: count },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`כבר קיימת קבוצה בשם "${label}"`);
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateAnalyticsGroupDto) {
    const row = await this.get(id);
    const patch: Prisma.AnalyticsGroupUpdateInput = {};
    if (dto.label !== undefined) {
      const next = dto.label.trim();
      if (!next) throw new BadRequestException('Label cannot be empty');
      patch.label = next;
    }
    try {
      return await this.prisma.analyticsGroup.update({
        where: { id: row.id },
        data: patch,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('כבר קיימת קבוצה בשם זה');
      }
      throw e;
    }
  }

  async remove(id: string) {
    const row = await this.get(id);
    // Deletion is refused when any context points at this group. Admins must
    // first reassign those contexts (or pick "ללא קבוצה"), which clears
    // analyticsGroupId and unblocks the delete.
    const inUse = await this.prisma.contextDefinition.count({
      where: { analyticsGroupId: row.id },
    });
    if (inUse > 0) {
      throw new ConflictException(
        `לא ניתן למחוק — הקבוצה בשימוש ב-${inUse} הקשרים. בטלי את השיוך קודם.`,
      );
    }
    await this.prisma.analyticsGroup.delete({ where: { id: row.id } });
    return { deleted: true };
  }
}
