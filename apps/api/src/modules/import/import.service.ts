import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Field keyword detection (adapted from grafitiyul-recruitment) ──────────

const FIELD_KEYWORDS: Record<string, string[]> = {
  firstName: ['שם פרטי', 'פרטי', 'first name', 'first_name'],
  lastName:  ['שם משפחה', 'משפחה', 'last name', 'last_name', 'surname'],
  fullName:  ['שם מלא', 'שם', 'full name', 'fullname', 'name'],
  phone:     ['טלפון', 'נייד', 'מספר טלפון', 'phone', 'mobile', 'cell'],
  email:     ['אימייל', 'מייל', 'דואר אלקטרוני', 'email', 'e-mail', 'mail'],
  city:      ['עיר', 'יישוב', 'מגורים', 'city', 'location'],
  gender:    ['מגדר', 'מין', 'gender', 'sex'],
  notes:     ['הערות', 'הערה', 'מידע נוסף', 'notes', 'comments', 'remarks'],
};

export interface ColumnMapping {
  firstName?: number | null;
  lastName?: number | null;
  fullName?: number | null;
  phone?: number | null;
  email?: number | null;
  city?: number | null;
  gender?: number | null;
  notes?: number | null;
}

export interface DetectResult {
  headers: string[];
  detected: ColumnMapping;
  sampleRows: string[][];
}

export interface PreviewRow {
  rowIndex: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  status: 'create' | 'update' | 'skip';
  skipReason?: string;
  extraData: Record<string, string>;
}

export interface RunImportDto {
  title: string;
  headers: string[];
  rows: string[][];
  mapping: ColumnMapping;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  participantIds: string[];
}

@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Detect column mapping from headers ────────────────────────────────────

  detect(headers: string[], sampleRows: string[][]): DetectResult {
    const detected: ColumnMapping = {};
    for (const [field, keywords] of Object.entries(FIELD_KEYWORDS)) {
      const idx = headers.findIndex((h) =>
        keywords.some((kw) => h.toLowerCase().trim().includes(kw.toLowerCase())),
      );
      (detected as Record<string, number | null>)[field] = idx >= 0 ? idx : null;
    }
    return { headers, detected, sampleRows: sampleRows.slice(0, 5) };
  }

  // ─── Preview what would happen ──────────────────────────────────────────────

  async preview(headers: string[], rows: string[][], mapping: ColumnMapping): Promise<PreviewRow[]> {
    const result: PreviewRow[] = [];
    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const row = rows[i];
      const extracted = this.extractRow(row, mapping, headers);
      const phone = normalizePhone(extracted.phone);
      if (!phone) {
        result.push({ rowIndex: i, ...extracted, phone: '', status: 'skip', skipReason: 'אין מספר טלפון', extraData: extracted.extraData });
        continue;
      }
      const existing = await this.prisma.participant.findUnique({ where: { phoneNumber: phone } });
      result.push({
        rowIndex: i,
        firstName: extracted.firstName,
        lastName: extracted.lastName,
        phone,
        email: extracted.email,
        status: existing ? 'update' : 'create',
        extraData: extracted.extraData,
      });
    }
    return result;
  }

  // ─── Run the actual import ──────────────────────────────────────────────────

  async run(dto: RunImportDto): Promise<ImportResult> {
    const { title, headers, rows, mapping } = dto;
    let created = 0, updated = 0, skipped = 0;
    const errors: string[] = [];
    const participantIds: string[] = [];

    // Get default gender (נקבה first, else first available)
    const femaleGender = await this.prisma.gender.findFirst({ where: { name: { contains: 'נקב' } } });
    const anyGender = femaleGender ?? await this.prisma.gender.findFirst();
    if (!anyGender) {
      throw new Error('No gender found in database — run seeder first');
    }

    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i];
        const extracted = this.extractRow(row, mapping, headers);
        const phone = normalizePhone(extracted.phone);
        if (!phone) { skipped++; continue; }

        // Build import key for idempotency
        const importKey = createHash('sha256')
          .update(`${title}|${phone}|${i}`)
          .digest('hex');

        // Skip if this exact row was already imported
        const existing = await this.prisma.participantFormSubmission.findUnique({ where: { importKey } });
        if (existing) { skipped++; continue; }

        // Upsert participant
        let participant = await this.prisma.participant.findUnique({ where: { phoneNumber: phone } });
        if (!participant) {
          const [firstName, ...rest] = (extracted.firstName || extracted.fullName || 'לא ידוע').split(' ');
          const lastName = extracted.lastName || rest.join(' ') || null;
          participant = await this.prisma.participant.create({
            data: {
              firstName: firstName || 'לא ידוע',
              lastName: lastName || null,
              phoneNumber: phone,
              email: extracted.email || null,
              city: extracted.city || null,
              genderId: anyGender.id,
              source: 'import',
            },
          });
          created++;
        } else {
          // Update empty fields
          const updates: Record<string, string | null> = {};
          if (!participant.email && extracted.email) updates.email = extracted.email;
          if (!participant.city && extracted.city) updates.city = extracted.city;
          if (Object.keys(updates).length > 0) {
            await this.prisma.participant.update({ where: { id: participant.id }, data: updates });
          }
          updated++;
        }

        participantIds.push(participant.id);

        // Build full data snapshot (all columns)
        const fullData: Record<string, string> = {};
        headers.forEach((h, idx) => {
          if (row[idx] !== undefined && row[idx] !== '') {
            fullData[h] = row[idx];
          }
        });

        await this.prisma.participantFormSubmission.create({
          data: {
            participantId: participant.id,
            source: 'import',
            title,
            data: fullData,
            importKey,
          },
        });
      } catch (err) {
        errors.push(`שורה ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
        skipped++;
      }
    }

    return { created, updated, skipped, errors, participantIds };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private extractRow(
    row: string[],
    mapping: ColumnMapping,
    headers: string[],
  ): { firstName: string; lastName: string; fullName: string; phone: string; email: string; city: string; extraData: Record<string, string> } {
    const get = (idx: number | null | undefined) => (idx != null && idx >= 0 && idx < row.length ? (row[idx] ?? '').trim() : '');
    const mappedIndices = new Set(Object.values(mapping).filter((v) => v != null));
    const extraData: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (!mappedIndices.has(i) && row[i] && row[i].trim()) extraData[h] = row[i].trim();
    });
    return {
      firstName: get(mapping.firstName),
      lastName:  get(mapping.lastName),
      fullName:  get(mapping.fullName),
      phone:     get(mapping.phone),
      email:     get(mapping.email),
      city:      get(mapping.city),
      extraData,
    };
  }
}

// ─── Phone normalization ─────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  // Israeli: strip leading country code 972 → 0
  if (digits.startsWith('972') && digits.length >= 12) return '0' + digits.slice(3);
  if (digits.startsWith('972') && digits.length === 12) return '0' + digits.slice(3);
  if (digits.length === 9 && !digits.startsWith('0')) return '0' + digits;
  return digits;
}
