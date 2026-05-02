import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto, TimingType } from './dto/template.dto';

// Validate the timing-type-specific fields. Centralised so create
// and update share the same rules. Throws BadRequestException with
// a Hebrew message on the first violation.
function validateTimingFields(
  timingType: TimingType,
  fields: {
    exactAt?: string | null;
    dayOfNumber?: number | null;
    offsetDays?: number | null;
    timeOfDay?: string | null;
  },
): void {
  switch (timingType) {
    case 'exact':
      if (!fields.exactAt) {
        throw new BadRequestException('עבור תזמון "תאריך מדויק" יש לציין תאריך ושעה');
      }
      return;
    case 'day_of':
      if (!fields.dayOfNumber || fields.dayOfNumber < 1) {
        throw new BadRequestException('עבור תזמון "יום N של המשחק" יש לציין מספר יום (1 ומעלה)');
      }
      if (!fields.timeOfDay) {
        throw new BadRequestException('עבור תזמון "יום N של המשחק" יש לציין שעה ביום');
      }
      return;
    case 'before_start':
      if (fields.offsetDays === null || fields.offsetDays === undefined || fields.offsetDays < 0) {
        throw new BadRequestException('עבור תזמון "X ימים לפני התחלה" יש לציין מספר ימים (0 ומעלה)');
      }
      if (!fields.timeOfDay) {
        throw new BadRequestException('עבור תזמון "X ימים לפני התחלה" יש לציין שעה ביום');
      }
      return;
    case 'after_end':
      if (fields.offsetDays === null || fields.offsetDays === undefined || fields.offsetDays < 0) {
        throw new BadRequestException('עבור תזמון "X ימים אחרי סיום" יש לציין מספר ימים (0 ומעלה)');
      }
      if (!fields.timeOfDay) {
        throw new BadRequestException('עבור תזמון "X ימים אחרי סיום" יש לציין שעה ביום');
      }
      return;
  }
}

@Injectable()
export class ScheduledMessageTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  list(programId: string) {
    return this.prisma.programScheduledMessageTemplate.findMany({
      where: { programId, isActive: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(programId: string, dto: CreateTemplateDto) {
    validateTimingFields(dto.timingType, dto);
    // Verify program exists — clearer error than a Prisma FK violation.
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { id: true },
    });
    if (!program) throw new NotFoundException('התוכנית לא נמצאה');

    return this.prisma.programScheduledMessageTemplate.create({
      data: {
        programId,
        category: dto.category.trim(),
        internalName: dto.internalName.trim(),
        content: dto.content,
        timingType: dto.timingType,
        // Persist only the relevant fields per timing type. Other
        // columns stay null so a switch from 'day_of' to 'exact'
        // doesn't leave stale dayOfNumber lying around.
        exactAt: dto.timingType === 'exact' && dto.exactAt ? new Date(dto.exactAt) : null,
        dayOfNumber: dto.timingType === 'day_of' ? dto.dayOfNumber ?? null : null,
        offsetDays:
          dto.timingType === 'before_start' || dto.timingType === 'after_end'
            ? dto.offsetDays ?? null
            : null,
        timeOfDay: dto.timingType !== 'exact' ? dto.timeOfDay ?? null : null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(programId: string, templateId: string, dto: UpdateTemplateDto) {
    const existing = await this.prisma.programScheduledMessageTemplate.findFirst({
      where: { id: templateId, programId },
    });
    if (!existing) throw new NotFoundException('התבנית לא נמצאה');

    // Compute the resulting timingType so we know which timing fields
    // to validate + persist.
    const nextTimingType = (dto.timingType ?? existing.timingType) as TimingType;
    const merged = {
      exactAt: dto.exactAt !== undefined ? dto.exactAt : existing.exactAt?.toISOString(),
      dayOfNumber: dto.dayOfNumber !== undefined ? dto.dayOfNumber : existing.dayOfNumber,
      offsetDays: dto.offsetDays !== undefined ? dto.offsetDays : existing.offsetDays,
      timeOfDay: dto.timeOfDay !== undefined ? dto.timeOfDay : existing.timeOfDay,
    };
    validateTimingFields(nextTimingType, merged);

    return this.prisma.programScheduledMessageTemplate.update({
      where: { id: templateId },
      data: {
        ...(dto.category !== undefined ? { category: dto.category.trim() } : {}),
        ...(dto.internalName !== undefined ? { internalName: dto.internalName.trim() } : {}),
        ...(dto.content !== undefined ? { content: dto.content } : {}),
        ...(dto.timingType !== undefined ? { timingType: dto.timingType } : {}),
        // Whenever the timing type might change, normalise the four
        // mode-specific columns so only the relevant ones carry data.
        exactAt: nextTimingType === 'exact' && merged.exactAt
          ? new Date(merged.exactAt)
          : null,
        dayOfNumber: nextTimingType === 'day_of' ? merged.dayOfNumber ?? null : null,
        offsetDays:
          nextTimingType === 'before_start' || nextTimingType === 'after_end'
            ? merged.offsetDays ?? null
            : null,
        timeOfDay: nextTimingType !== 'exact' ? merged.timeOfDay ?? null : null,
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // Soft delete only — group rows that already cloned this template
  // keep their snapshot and the FK is set null on hard delete by the
  // schema, but we never hard-delete from this entry point.
  async deactivate(programId: string, templateId: string) {
    const existing = await this.prisma.programScheduledMessageTemplate.findFirst({
      where: { id: templateId, programId },
    });
    if (!existing) throw new NotFoundException('התבנית לא נמצאה');
    return this.prisma.programScheduledMessageTemplate.update({
      where: { id: templateId },
      data: { isActive: false },
    });
  }

  async reorder(programId: string, items: { id: string; sortOrder: number }[]) {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.programScheduledMessageTemplate.update({
          where: { id: item.id, programId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
    return { ok: true as const };
  }
}
