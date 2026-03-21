import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateParticipantDto } from './dto/create-participant.dto';

const MOCK_NAMES = [
  'שרה כהן',
  'מיכל לוי',
  'רחל ישראלי',
  'דבורה אביב',
  'רות מזרחי',
  'חנה גולן',
  'אסתר שמיר',
  'רבקה אדלר',
  'יעל ברק',
  'נועה כרמי',
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

  async findAll(includeMock = false) {
    return this.prisma.participant.findMany({
      where: {
        isActive: true,
        ...(includeMock ? {} : { isMock: false }),
      },
      include: { gender: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    return this.prisma.participant.findUnique({
      where: { id },
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
      },
    });
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
          fullName: dto.fullName,
          phoneNumber: dto.phoneNumber,
          genderId,
          ...(dto.email ? { email: dto.email } : {}),
          ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}),
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

  async createMock(count: number = 10) {
    // Ensure default genders exist — no dependency on seed
    const genderIds = await Promise.all(
      DEFAULT_GENDERS.map((name) => this.resolveGenderId(name)),
    );

    const names = MOCK_NAMES.slice(0, Math.min(count, MOCK_NAMES.length));
    // Unique phone suffix per invocation — last 4 digits of timestamp + 3-digit index
    const ts = String(Date.now()).slice(-4);

    const results = await Promise.allSettled(
      names.map((name, i) => {
        const phoneNumber = `055${ts}${String(i).padStart(3, '0')}`;
        return this.prisma.participant.upsert({
          where: { phoneNumber },
          create: {
            fullName: name,
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
}
