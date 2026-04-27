import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Shape served to both /api/portal/profile/:token and the admin read-only
// view. Keeps the two surfaces identical so admins see exactly what
// participants see.
export interface ProfileSnapshot {
  participant: {
    id: string;
    firstName: string;
    lastName: string | null;
    profileImageUrl: string | null;
  };
  program: {
    id: string;
    name: string;
    profileTabEnabled: boolean;
  };
  fields: Array<{
    id: string;
    fieldKey: string;
    label: string;
    helperText: string | null;
    fieldType: string;
    isRequired: boolean;
    isSystemField: boolean;
    sortOrder: number;
  }>;
  // fieldKey -> primitive value or array of file references
  values: Record<string, unknown>;
  // file id -> { id, url, mimeType, sizeBytes, uploadedAt }
  files: Record<string, FileMeta>;
  missingRequiredCount: number;
  missingRequiredKeys: string[];
}

export interface FileMeta {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

const SYSTEM_FIELD_PARTICIPANT_COLUMNS: Record<string, keyof Prisma.ParticipantUpdateInput> = {
  firstName: 'firstName',
  lastName: 'lastName',
  phoneNumber: 'phoneNumber',
  email: 'email',
  birthDate: 'birthDate',
  city: 'city',
  profileImageUrl: 'profileImageUrl',
};

@Injectable()
export class ParticipantProfilePortalService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Token resolution ────────────────────────────────────────────────────
  // Mirrors the helper in game-engine.participant-portal.service so
  // /tg/:token, /t/:token, and the admin token preview all resolve the
  // same way. Returns the active group's programId — a participant can
  // only have one active membership in a given program (enforced
  // earlier by autoJoinGroup).
  async resolveByToken(token: string): Promise<{ participantId: string; programId: string }> {
    if (!token) throw new NotFoundException('הקישור אינו בתוקף');

    const direct = await this.prisma.participant.findUnique({
      where: { accessToken: token },
      select: {
        id: true,
        participantGroups: {
          where: { isActive: true, group: { programId: { not: null } } },
          orderBy: { joinedAt: 'desc' },
          take: 1,
          select: { group: { select: { programId: true } } },
        },
      },
    });
    if (direct?.participantGroups[0]?.group?.programId) {
      return { participantId: direct.id, programId: direct.participantGroups[0].group.programId };
    }

    const legacy = await this.prisma.participantGroup.findUnique({
      where: { accessToken: token },
      select: { participantId: true, isActive: true, group: { select: { programId: true } } },
    });
    if (legacy?.isActive && legacy.group?.programId) {
      return { participantId: legacy.participantId, programId: legacy.group.programId };
    }

    throw new NotFoundException('הקישור אינו בתוקף');
  }

  // ── Read snapshot ───────────────────────────────────────────────────────

  async getProfileForParticipant(participantId: string, programId: string): Promise<ProfileSnapshot> {
    const [participant, program, fields, valueRows] = await Promise.all([
      this.prisma.participant.findUnique({
        where: { id: participantId },
        select: {
          id: true, firstName: true, lastName: true,
          phoneNumber: true, email: true, birthDate: true,
          city: true, profileImageUrl: true,
        },
      }),
      this.prisma.program.findUnique({
        where: { id: programId },
        select: { id: true, name: true, profileTabEnabled: true },
      }),
      this.prisma.programProfileField.findMany({
        where: { programId, isActive: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.participantProfileValue.findMany({
        where: { participantId, programId },
      }),
    ]);
    if (!participant) throw new NotFoundException('משתתפת לא נמצאה');
    if (!program) throw new NotFoundException('תוכנית לא נמצאה');

    // Build fieldKey -> raw value, sourced from Participant for system
    // fields and from ParticipantProfileValue for custom fields.
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.isSystemField) {
        values[f.fieldKey] = (participant as Record<string, unknown>)[f.fieldKey] ?? null;
      } else {
        const row = valueRows.find((v) => v.fieldKey === f.fieldKey);
        values[f.fieldKey] = row?.value ?? null;
      }
    }

    // Resolve all referenced file ids in one batch so the frontend can
    // render previews without a round trip per image.
    const referencedFileIds = new Set<string>();
    for (const f of fields) {
      const v = values[f.fieldKey];
      if (f.fieldType === 'image' && typeof v === 'string') referencedFileIds.add(v);
      if (f.fieldType === 'imageGallery' && Array.isArray(v)) {
        for (const id of v) if (typeof id === 'string') referencedFileIds.add(id);
      }
    }
    const fileRows = referencedFileIds.size
      ? await this.prisma.participantUploadedFile.findMany({
          where: { id: { in: [...referencedFileIds] }, participantId },
        })
      : [];
    const files: Record<string, FileMeta> = {};
    for (const r of fileRows) {
      files[r.id] = {
        id: r.id, url: r.url, mimeType: r.mimeType,
        sizeBytes: r.sizeBytes, uploadedAt: r.uploadedAt.toISOString(),
      };
    }
    // Also expose profileImageUrl as a synthetic file entry — the field
    // renders the URL directly off Participant, so the frontend needs a
    // src to hang an <img> off without going through ParticipantUploadedFile.
    // (Required-check for profileImageUrl uses the url, not a file id.)

    const missingRequiredKeys: string[] = [];
    for (const f of fields) {
      if (!f.isRequired) continue;
      if (this.isMissing(values[f.fieldKey], f.fieldType, files)) {
        missingRequiredKeys.push(f.fieldKey);
      }
    }

    return {
      participant: {
        id: participant.id,
        firstName: participant.firstName,
        lastName: participant.lastName,
        profileImageUrl: participant.profileImageUrl,
      },
      program: {
        id: program.id,
        name: program.name,
        profileTabEnabled: program.profileTabEnabled,
      },
      fields: fields.map((f) => ({
        id: f.id,
        fieldKey: f.fieldKey,
        label: f.label,
        helperText: f.helperText,
        fieldType: f.fieldType,
        isRequired: f.isRequired,
        isSystemField: f.isSystemField,
        sortOrder: f.sortOrder,
      })),
      values,
      files,
      missingRequiredCount: missingRequiredKeys.length,
      missingRequiredKeys,
    };
  }

  // ── Save one value ──────────────────────────────────────────────────────

  async setValueForParticipant(
    participantId: string,
    programId: string,
    fieldKey: string,
    rawValue: unknown,
  ): Promise<ProfileSnapshot> {
    const field = await this.prisma.programProfileField.findUnique({
      where: { programId_fieldKey: { programId, fieldKey } },
    });
    if (!field || !field.isActive) {
      throw new NotFoundException(`Field "${fieldKey}" not configured for this program`);
    }

    const normalised = await this.normalise(rawValue, field.fieldType, participantId);

    if (field.isSystemField) {
      const column = SYSTEM_FIELD_PARTICIPANT_COLUMNS[fieldKey];
      if (!column) {
        throw new BadRequestException(`fieldKey "${fieldKey}" is not a recognised system field`);
      }
      await this.writeSystemField(participantId, column, fieldKey, normalised);
    } else {
      // Upsert into ParticipantProfileValue. Storing null is fine — it
      // represents an explicitly cleared field.
      await this.prisma.participantProfileValue.upsert({
        where: { participantId_programId_fieldKey: { participantId, programId, fieldKey } },
        create: { participantId, programId, fieldKey, value: normalised as Prisma.InputJsonValue },
        update: { value: normalised as Prisma.InputJsonValue },
      });
    }

    return this.getProfileForParticipant(participantId, programId);
  }

  // ── File upload ─────────────────────────────────────────────────────────
  // Called by the controller after multer has stored the file. Records
  // the row + metadata so missing-checks and gallery views work.
  async recordUpload(
    participantId: string,
    info: { url: string; mimeType: string; sizeBytes: number; category?: string },
  ): Promise<FileMeta> {
    const row = await this.prisma.participantUploadedFile.create({
      data: {
        participantId,
        category: info.category ?? 'profile_field',
        url: info.url,
        mimeType: info.mimeType,
        sizeBytes: info.sizeBytes,
      },
    });
    return {
      id: row.id, url: row.url, mimeType: row.mimeType,
      sizeBytes: row.sizeBytes, uploadedAt: row.uploadedAt.toISOString(),
    };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private async writeSystemField(
    participantId: string,
    column: keyof Prisma.ParticipantUpdateInput,
    fieldKey: string,
    value: unknown,
  ) {
    // Date fields go through Date; profileImageUrl writes a URL string;
    // everything else is a trimmed string (or null when cleared).
    let coerced: unknown = value;
    if (fieldKey === 'birthDate') {
      if (value == null || value === '') coerced = null;
      else {
        const d = new Date(String(value));
        if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
        coerced = d;
      }
    } else if (fieldKey === 'profileImageUrl') {
      // value is expected to be a file id from the upload endpoint;
      // resolve it to the URL stored on ParticipantUploadedFile so the
      // existing avatar rendering keeps working unchanged.
      if (value == null || value === '') {
        coerced = null;
      } else if (typeof value === 'string') {
        const file = await this.prisma.participantUploadedFile.findFirst({
          where: { id: value, participantId },
        });
        if (!file) throw new BadRequestException('Uploaded file not found for this participant');
        coerced = file.url;
      } else {
        throw new BadRequestException('profileImageUrl expects a file id');
      }
    } else {
      coerced = value == null ? null : String(value);
    }
    try {
      await this.prisma.participant.update({
        where: { id: participantId },
        data: { [column]: coerced } as Prisma.ParticipantUpdateInput,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Value conflicts with another participant (unique constraint)');
      }
      throw err;
    }
  }

  // Validate + coerce a value to its persistent shape per fieldType.
  // Image / imageGallery values are stored as file ids; the controller
  // verifies the ids belong to the participant before we get here.
  private async normalise(rawValue: unknown, fieldType: string, participantId: string): Promise<unknown> {
    const isEmpty = rawValue === null || rawValue === undefined || rawValue === '';
    switch (fieldType) {
      case 'text':
      case 'textarea':
        if (isEmpty) return null;
        if (typeof rawValue !== 'string') throw new BadRequestException('Expected a string');
        return rawValue.trim() || null;
      case 'number':
        if (isEmpty) return null;
        const n = typeof rawValue === 'number' ? rawValue : Number(rawValue);
        if (!Number.isFinite(n)) throw new BadRequestException('Expected a number');
        return n;
      case 'date':
        if (isEmpty) return null;
        const d = new Date(String(rawValue));
        if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
        // Stored as YYYY-MM-DD ISO date string for non-system fields.
        return d.toISOString().slice(0, 10);
      case 'image':
        if (isEmpty) return null;
        if (typeof rawValue !== 'string') throw new BadRequestException('image expects a file id');
        await this.assertFileOwnership(participantId, [rawValue]);
        return rawValue;
      case 'imageGallery':
        if (isEmpty) return [];
        if (!Array.isArray(rawValue)) throw new BadRequestException('imageGallery expects an array of file ids');
        const ids = rawValue.filter((v): v is string => typeof v === 'string');
        if (ids.length !== rawValue.length) {
          throw new BadRequestException('All gallery entries must be file ids (strings)');
        }
        if (ids.length) await this.assertFileOwnership(participantId, ids);
        return ids;
      default:
        throw new BadRequestException(`Unsupported fieldType "${fieldType}"`);
    }
  }

  private async assertFileOwnership(participantId: string, ids: string[]) {
    const owned = await this.prisma.participantUploadedFile.findMany({
      where: { id: { in: ids }, participantId },
      select: { id: true },
    });
    const ownedSet = new Set(owned.map((o) => o.id));
    const stray = ids.filter((id) => !ownedSet.has(id));
    if (stray.length) {
      throw new ForbiddenException(`Files do not belong to this participant: ${stray.join(',')}`);
    }
  }

  // Required-check used by getProfileForParticipant. A field is missing
  // when its value is null/empty per its type.
  private isMissing(value: unknown, fieldType: string, files: Record<string, FileMeta>): boolean {
    switch (fieldType) {
      case 'text':
      case 'textarea':
        return typeof value !== 'string' || !value.trim();
      case 'number':
        return typeof value !== 'number' || !Number.isFinite(value);
      case 'date':
        return !value || typeof value !== 'string';
      case 'image':
        // For system field profileImageUrl the value is a URL string;
        // for custom image fields it's a file id that must resolve to a
        // known FileMeta entry.
        if (typeof value !== 'string' || !value) return true;
        if (value.startsWith('/') || value.startsWith('http')) return false;
        return !files[value];
      case 'imageGallery':
        if (!Array.isArray(value) || value.length === 0) return true;
        return !value.some((id) => typeof id === 'string' && files[id]);
      default:
        return value == null || value === '';
    }
  }
}
