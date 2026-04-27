import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PROFILE_FIELD_TYPES,
  ProfileFieldType,
  SYSTEM_FIELD_KEYS,
  UpsertProfileFieldDto,
} from './dto/upsert-field.dto';
import { ReorderFieldsDto } from './dto/reorder-fields.dto';

// System-field metadata. fieldKey must match a column on participants.
// fieldType is locked because it's defined by the underlying column type
// (date for birthDate, image for profileImageUrl, text for everything
// else). Default labels are used when the admin clicks "add system field"
// without overriding them.
const SYSTEM_FIELD_META: Record<
  (typeof SYSTEM_FIELD_KEYS)[number],
  { defaultLabel: string; fieldType: 'text' | 'date' | 'image' }
> = {
  firstName:       { defaultLabel: 'שם פרטי',     fieldType: 'text' },
  lastName:        { defaultLabel: 'שם משפחה',    fieldType: 'text' },
  phoneNumber:     { defaultLabel: 'טלפון',       fieldType: 'text' },
  email:           { defaultLabel: 'אימייל',      fieldType: 'text' },
  birthDate:       { defaultLabel: 'תאריך לידה',  fieldType: 'date' },
  city:            { defaultLabel: 'עיר',         fieldType: 'text' },
  profileImageUrl: { defaultLabel: 'תמונת פרופיל', fieldType: 'image' },
};

// Game Changer preset — the canonical baseline questionnaire for the
// "הרגלי אכילה" game. Upserts by (programId, fieldKey) so re-applying
// the preset never duplicates rows.
const GAME_CHANGER_PRESET: Array<{
  fieldKey: string;
  label: string;
  fieldType: 'text' | 'textarea' | 'number' | 'image' | 'imageGallery';
  isRequired: boolean;
  isSystemField: boolean;
  helperText?: string;
}> = [
  { fieldKey: 'profileImageUrl',  label: 'תמונת פרופיל',          fieldType: 'image',        isRequired: true,  isSystemField: true,
    helperText: 'תמונת פנים שתשמש כתמונת הפרופיל שלך באתר ובמשחק' },
  { fieldKey: 'personalGoal',     label: 'המטרה שלי',             fieldType: 'textarea',     isRequired: true,  isSystemField: false,
    helperText: 'מה הסיבה שהצטרפת? איך תרגישי בסוף המשחק?' },
  { fieldKey: 'startingWeight',   label: 'משקל פתיחה',            fieldType: 'number',       isRequired: false, isSystemField: false,
    helperText: 'בק״ג. אופציונלי — נשמר אישית, לא מוצג לאף אחת אחרת' },
  { fieldKey: 'bodyMeasurements', label: 'היקפים',                fieldType: 'textarea',     isRequired: false, isSystemField: false,
    helperText: 'מותניים, חזה, ירכיים — לאן שתרצי' },
  { fieldKey: 'beforePhotos',     label: 'תמונות לפני המשחק',     fieldType: 'imageGallery', isRequired: false, isSystemField: false,
    helperText: 'אופציונלי — לתיעוד אישי' },
  { fieldKey: 'city',             label: 'עיר',                   fieldType: 'text',         isRequired: false, isSystemField: true },
];

@Injectable()
export class ProgramProfileFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns active fields by default, ordered by sortOrder. Admin views
  // pass includeInactive=true to see soft-deleted rows.
  async list(programId: string, opts: { includeInactive?: boolean } = {}) {
    await this.assertProgramExists(programId);
    return this.prisma.programProfileField.findMany({
      where: { programId, ...(opts.includeInactive ? {} : { isActive: true }) },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(programId: string, dto: UpsertProfileFieldDto) {
    await this.assertProgramExists(programId);
    const fieldKey = (dto.fieldKey ?? '').trim();
    const label = (dto.label ?? '').trim();
    if (!fieldKey) throw new BadRequestException('fieldKey is required');
    if (!label) throw new BadRequestException('label is required');
    const isSystemField = !!dto.isSystemField;
    const fieldType = this.resolveFieldType(fieldKey, dto.fieldType, isSystemField);

    if (isSystemField && !(SYSTEM_FIELD_KEYS as readonly string[]).includes(fieldKey)) {
      throw new BadRequestException(
        `fieldKey "${fieldKey}" is not a recognised system field. ` +
        `Allowed keys: ${SYSTEM_FIELD_KEYS.join(', ')}`,
      );
    }

    // Default sortOrder to (max + 10) so new fields appear at the end
    // without colliding with existing ones.
    const lastField = await this.prisma.programProfileField.findFirst({
      where: { programId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const sortOrder = dto.sortOrder ?? (lastField ? lastField.sortOrder + 10 : 10);

    try {
      return await this.prisma.programProfileField.create({
        data: {
          programId,
          fieldKey,
          label,
          helperText: dto.helperText ?? null,
          fieldType,
          isRequired: dto.isRequired ?? false,
          sortOrder,
          isSystemField,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException(`Field "${fieldKey}" already exists for this program`);
      }
      throw err;
    }
  }

  async update(programId: string, id: string, dto: UpsertProfileFieldDto) {
    await this.assertOwned(programId, id);
    const data: Prisma.ProgramProfileFieldUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label.trim();
    if (dto.helperText !== undefined) data.helperText = dto.helperText ? dto.helperText.trim() : null;
    if (dto.fieldType !== undefined) {
      if (!(PROFILE_FIELD_TYPES as readonly string[]).includes(dto.fieldType)) {
        throw new BadRequestException(`fieldType "${dto.fieldType}" is not allowed`);
      }
      data.fieldType = dto.fieldType;
    }
    if (dto.isRequired !== undefined) data.isRequired = dto.isRequired;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    // fieldKey + isSystemField are intentionally NOT updatable: changing
    // them would silently rebind existing values to the wrong target.
    return this.prisma.programProfileField.update({ where: { id }, data });
  }

  async deactivate(programId: string, id: string) {
    await this.assertOwned(programId, id);
    return this.prisma.programProfileField.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async reorder(programId: string, dto: ReorderFieldsDto) {
    await this.assertProgramExists(programId);
    if (!dto.items?.length) return { updated: 0 };
    // Verify every id belongs to this program — guards against the admin
    // accidentally moving rows from another program via a stale UI.
    const owned = await this.prisma.programProfileField.findMany({
      where: { programId, id: { in: dto.items.map((i) => i.id) } },
      select: { id: true },
    });
    const ownedSet = new Set(owned.map((o) => o.id));
    const stray = dto.items.filter((i) => !ownedSet.has(i.id));
    if (stray.length) {
      throw new BadRequestException(`Field id(s) not in program ${programId}: ${stray.map((s) => s.id).join(',')}`);
    }
    await Promise.all(dto.items.map((i) =>
      this.prisma.programProfileField.update({ where: { id: i.id }, data: { sortOrder: i.sortOrder } }),
    ));
    return { updated: dto.items.length };
  }

  // Game Changer preset — upsert each row by (programId, fieldKey) so
  // re-running the preset is idempotent. Returns the resulting list.
  async applyGameChangerPreset(programId: string) {
    await this.assertProgramExists(programId);
    let order = 10;
    for (const tpl of GAME_CHANGER_PRESET) {
      const sortOrder = order;
      order += 10;
      await this.prisma.programProfileField.upsert({
        where: { programId_fieldKey: { programId, fieldKey: tpl.fieldKey } },
        create: {
          programId,
          fieldKey: tpl.fieldKey,
          label: tpl.label,
          helperText: tpl.helperText ?? null,
          fieldType: tpl.fieldType,
          isRequired: tpl.isRequired,
          isSystemField: tpl.isSystemField,
          sortOrder,
          isActive: true,
        },
        // Only refresh the user-visible bits — never overwrite a manually
        // re-ordered row. We DO update label / helperText / isRequired so
        // the admin can re-pull the latest copy of the canonical preset.
        update: {
          label: tpl.label,
          helperText: tpl.helperText ?? null,
          isRequired: tpl.isRequired,
          isActive: true,
        },
      });
    }
    return this.list(programId);
  }

  private resolveFieldType(
    fieldKey: string,
    requested: string | undefined,
    isSystemField: boolean,
  ): ProfileFieldType {
    if (isSystemField) {
      const meta = SYSTEM_FIELD_META[fieldKey as (typeof SYSTEM_FIELD_KEYS)[number]];
      if (meta) return meta.fieldType;
    }
    if (!requested) throw new BadRequestException('fieldType is required for custom fields');
    if (!(PROFILE_FIELD_TYPES as readonly string[]).includes(requested)) {
      throw new BadRequestException(`fieldType "${requested}" is not allowed`);
    }
    return requested as ProfileFieldType;
  }

  private async assertProgramExists(programId: string) {
    const p = await this.prisma.program.findUnique({ where: { id: programId }, select: { id: true } });
    if (!p) throw new NotFoundException(`Program ${programId} not found`);
  }

  private async assertOwned(programId: string, id: string) {
    const f = await this.prisma.programProfileField.findUnique({ where: { id } });
    if (!f || f.programId !== programId) {
      throw new NotFoundException(`Profile field ${id} not found in program ${programId}`);
    }
  }
}
