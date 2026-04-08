import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GameEngineService } from './game-engine.service';

export interface PortalContext {
  participant: { id: string; firstName: string; lastName: string | null };
  group: { id: string; name: string; startDate: Date | null; endDate: Date | null };
  program: { id: string; name: string; isActive: boolean };
  actions: {
    id: string;
    name: string;
    description: string | null;
    inputType: string | null;
    aggregationMode: string;
    unit: string | null;
    points: number;
    maxPerDay: number | null;
  }[];
  todayScore: number;
  todayValues: Record<string, number>; // actionId → current daily value (count for boolean, numeric value otherwise)
}

@Injectable()
export class ParticipantPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameEngine: GameEngineService,
  ) {}

  async getContext(token: string): Promise<PortalContext> {
    const pg = await this.prisma.participantGroup.findUnique({
      where: { accessToken: token },
      include: {
        participant: {
          select: { id: true, firstName: true, lastName: true },
        },
        group: {
          include: {
            program: true,
            challenge: { select: { startDate: true, endDate: true } },
          },
        },
      },
    });

    if (!pg || !pg.isActive) throw new NotFoundException('הקישור אינו בתוקף');
    if (!pg.group.programId || !pg.group.program) throw new NotFoundException('לא נמצאה תוכנית');
    if (!pg.group.program.isActive) throw new BadRequestException('program_inactive');

    const programId = pg.group.programId;

    const actions = await this.prisma.gameAction.findMany({
      where: { programId, isActive: true, showInPortal: true },
      orderBy: { createdAt: 'asc' },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const scoreAgg = await this.prisma.scoreEvent.aggregate({
      _sum: { points: true },
      where: { participantId: pg.participantId, programId, createdAt: { gte: todayStart } },
    });

    const todayValues: Record<string, number> = {};
    for (const action of actions) {
      if (action.inputType === 'number') {
        todayValues[action.id] = await this.getEffectiveDailyValue(
          pg.participantId, programId, action.id, todayStart, action.aggregationMode,
        );
      } else {
        todayValues[action.id] = await this.prisma.userActionLog.count({
          where: { participantId: pg.participantId, actionId: action.id, createdAt: { gte: todayStart } },
        });
      }
    }

    return {
      participant: pg.participant,
      group: {
        id: pg.group.id,
        name: pg.group.name,
        startDate: pg.group.startDate ?? pg.group.challenge.startDate,
        endDate: pg.group.endDate ?? pg.group.challenge.endDate,
      },
      program: {
        id: pg.group.program.id,
        name: pg.group.program.name,
        isActive: pg.group.program.isActive,
      },
      actions,
      todayScore: scoreAgg._sum.points ?? 0,
      todayValues,
    };
  }

  async logAction(
    token: string,
    dto: { actionId: string; value?: string },
  ): Promise<{ pointsEarned: number; todayScore: number; todayValue: number | null }> {
    const pg = await this.prisma.participantGroup.findUnique({
      where: { accessToken: token },
      include: { group: { select: { programId: true, id: true } } },
    });
    if (!pg || !pg.isActive) throw new NotFoundException('הקישור אינו בתוקף');
    if (!pg.group.programId) throw new NotFoundException('לא נמצאה תוכנית');

    const result = await this.gameEngine.logAction({
      participantId: pg.participantId,
      programId: pg.group.programId,
      groupId: pg.groupId,
      actionId: dto.actionId,
      value: dto.value,
    });

    // Compute updated today score and action value for the response
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const scoreAgg = await this.prisma.scoreEvent.aggregate({
      _sum: { points: true },
      where: { participantId: pg.participantId, programId: pg.group.programId, createdAt: { gte: todayStart } },
    });

    const action = await this.prisma.gameAction.findUnique({ where: { id: dto.actionId } });
    let todayValue: number | null = null;
    if (action) {
      if (action.inputType === 'number') {
        todayValue = await this.getEffectiveDailyValue(
          pg.participantId, pg.group.programId, dto.actionId, todayStart, action.aggregationMode,
        );
      } else {
        todayValue = await this.prisma.userActionLog.count({
          where: { participantId: pg.participantId, actionId: dto.actionId, createdAt: { gte: todayStart } },
        });
      }
    }

    const pointsEarned =
      result.scoreEvent.points +
      result.ruleResults.reduce((sum: number, r: { fired: boolean; points?: number }) => sum + (r.fired ? (r.points ?? 0) : 0), 0);

    return {
      pointsEarned,
      todayScore: scoreAgg._sum.points ?? 0,
      todayValue,
    };
  }

  private async getEffectiveDailyValue(
    participantId: string,
    programId: string,
    actionId: string,
    todayStart: Date,
    aggregationMode: string,
  ): Promise<number> {
    const logs = await this.prisma.userActionLog.findMany({
      where: { participantId, programId, actionId, createdAt: { gte: todayStart } },
      select: { value: true },
    });
    if (logs.length === 0) return 0;
    const values = logs.map((l) => parseFloat(l.value ?? '0')).filter((v) => !isNaN(v));
    if (aggregationMode === 'latest_value') return Math.max(...values);
    if (aggregationMode === 'incremental_sum') return values.reduce((a, b) => a + b, 0);
    return 0;
  }
}
