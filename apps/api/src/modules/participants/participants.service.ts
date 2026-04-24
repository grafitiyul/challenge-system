import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateParticipantDto } from './dto/create-participant.dto';
import { UpdateParticipantDto } from './dto/update-participant.dto';

function randomAlphanumeric(length: number): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

const MOCK_DATA = [
  { firstName: 'שרה', lastName: 'כהן' },
  { firstName: 'מיכל', lastName: 'לוי' },
  { firstName: 'רחל', lastName: 'ישראלי' },
  { firstName: 'דבורה', lastName: 'אביב' },
  { firstName: 'רות', lastName: 'מזרחי' },
  { firstName: 'חנה', lastName: 'גולן' },
  { firstName: 'אסתר', lastName: 'שמיר' },
  { firstName: 'רבקה', lastName: 'אדלר' },
  { firstName: 'יעל', lastName: 'ברק' },
  { firstName: 'נועה', lastName: 'כרמי' },
];

// Default genders used when DB has none seeded yet
const DEFAULT_GENDERS = ['נקבה', 'זכר'];

@Injectable()
export class ParticipantsService {
  constructor(private readonly prisma: PrismaService) {}

  // Finds a gender by name, or creates it if missing — never throws due to missing config
  private async resolveGenderId(name: string): Promise<string> {
    let gender = await this.prisma.gender.findFirst({ where: { name } });
    if (!gender) {
      gender = await this.prisma.gender.create({ data: { name } });
    }
    return gender.id;
  }

  async findAll(opts: {
    includeMock?: boolean;
    status?: string;
    source?: string;
    hasPayments?: boolean;
  } = {}) {
    const { includeMock = false, status, source, hasPayments } = opts;
    const rows = await this.prisma.participant.findMany({
      where: {
        isActive: true,
        ...(includeMock ? {} : { isMock: false }),
        ...(status ? { status } : {}),
        ...(source ? { source } : {}),
        ...(hasPayments === true ? { payments: { some: {} } } : {}),
        ...(hasPayments === false ? { payments: { none: {} } } : {}),
      },
      relationLoadStrategy: 'join',
      include: {
        gender: true,
        _count: { select: { payments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Flatten _count.payments → paymentsCount so the admin list doesn't
    // have to reach into a nested shape per row.
    return rows.map((r) => {
      const { _count, ...rest } = r;
      return { ...rest, paymentsCount: _count?.payments ?? 0 };
    });
  }

  async findById(id: string) {
    const row = await this.prisma.participant.findUnique({
      where: { id },
      relationLoadStrategy: 'join',
      include: {
        gender: true,
        participantGroups: {
          where: { isActive: true },
          include: {
            group: {
              include: { challenge: true },
            },
          },
          orderBy: { joinedAt: 'desc' },
        },
        _count: { select: { payments: true } },
      },
    });
    if (!row) return null;
    const { _count, ...rest } = row;
    return { ...rest, paymentsCount: _count?.payments ?? 0 };
  }

  async findByGroup(groupId: string, includeMock = false) {
    const memberships = await this.prisma.participantGroup.findMany({
      where: {
        groupId,
        isActive: true,
        ...(includeMock ? {} : { participant: { isMock: false } }),
      },
      include: {
        participant: {
          include: { gender: true },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => m.participant);
  }

  async create(dto: CreateParticipantDto) {
    const genderId = await this.resolveGenderId(dto.genderName);

    let participant = await this.prisma.participant.findUnique({
      where: { phoneNumber: dto.phoneNumber },
    });

    if (!participant) {
      participant = await this.prisma.participant.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName ?? null,
          phoneNumber: dto.phoneNumber,
          genderId,
          ...(dto.email ? { email: dto.email } : {}),
          ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}),
          ...(dto.city ? { city: dto.city } : {}),
          ...(dto.source ? { source: dto.source } : {}),
        },
      });
    }

    if (dto.groupId) {
      await this.prisma.participantGroup.upsert({
        where: {
          participantId_groupId: {
            participantId: participant.id,
            groupId: dto.groupId,
          },
        },
        create: { participantId: participant.id, groupId: dto.groupId },
        update: { isActive: true, leftAt: null },
      });
    }

    return this.prisma.participant.findUnique({
      where: { id: participant.id },
      include: { gender: true },
    });
  }

  async update(id: string, dto: UpdateParticipantDto) {
    return this.prisma.participant.update({
      where: { id },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName || null } : {}),
        ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber } : {}),
        ...(dto.email !== undefined ? { email: dto.email || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        ...(dto.nextAction !== undefined ? { nextAction: dto.nextAction || null } : {}),
        ...(dto.city !== undefined ? { city: dto.city || null } : {}),
        ...(dto.profileImageUrl !== undefined ? { profileImageUrl: dto.profileImageUrl || null } : {}),
        ...(dto.source !== undefined ? { source: dto.source || null } : {}),
        ...(dto.birthDate !== undefined ? { birthDate: dto.birthDate ? new Date(dto.birthDate) : null } : {}),
        ...(dto.canManageProjects !== undefined ? { canManageProjects: dto.canManageProjects } : {}),
      },
      include: { gender: true },
    });
  }

  async createMock(count: number = 10) {
    // Ensure default genders exist — no dependency on seed
    const genderIds = await Promise.all(
      DEFAULT_GENDERS.map((name) => this.resolveGenderId(name)),
    );

    const data = MOCK_DATA.slice(0, Math.min(count, MOCK_DATA.length));
    // Unique phone suffix per invocation — last 4 digits of timestamp + 3-digit index
    const ts = String(Date.now()).slice(-4);

    const results = await Promise.allSettled(
      data.map((entry, i) => {
        const phoneNumber = `055${ts}${String(i).padStart(3, '0')}`;
        return this.prisma.participant.upsert({
          where: { phoneNumber },
          create: {
            firstName: entry.firstName,
            lastName: entry.lastName,
            phoneNumber,
            genderId: genderIds[i % genderIds.length],
            isMock: true,
          },
          update: { isMock: true },
          include: { gender: true },
        });
      }),
    );

    return results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<unknown>).value);
  }

  // ─── Soft-delete ────────────────────────────────────────────────────────────

  async deactivate(id: string) {
    const p = await this.prisma.participant.findUnique({ where: { id } });
    if (!p) throw new NotFoundException(`Participant ${id} not found`);
    return this.prisma.participant.update({ where: { id }, data: { isActive: false } });
  }

  // ─── Form submissions ───────────────────────────────────────────────────────

  async listFormSubmissions(participantId: string) {
    return this.prisma.participantFormSubmission.findMany({
      where: { participantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── Participant portal token ───────────────────────────────────────────────

  async generateAccessToken(participantId: string, groupId: string): Promise<{ token: string }> {
    const pg = await this.prisma.participantGroup.findUnique({
      where: { participantId_groupId: { participantId, groupId } },
    });
    if (!pg) throw new NotFoundException('Participant is not a member of this group');

    // Return existing token if already generated
    if (pg.accessToken) return { token: pg.accessToken };

    // Generate a new unique 12-char token
    let token: string;
    let attempts = 0;
    do {
      token = randomAlphanumeric(12);
      const existing = await this.prisma.participantGroup.findUnique({ where: { accessToken: token } });
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    await this.prisma.participantGroup.update({
      where: { participantId_groupId: { participantId, groupId } },
      data: { accessToken: token! },
    });

    return { token: token! };
  }
}
