import { createHmac } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GameEngineService } from './game-engine.service';

export interface PortalContext {
  participant: { id: string; firstName: string; lastName: string | null };
  group: { id: string; name: string; startDate: Date | null; endDate: Date | null };
  program: { id: string; name: string; isActive: boolean };
  // Portal opening gate — both null means always open (backward compatible)
  // UTC ISO strings; frontend resolves state A/B/C purely by comparing now() to these values
  portalCallTime: string | null;
  portalOpenTime: string | null;
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
  todayValues: Record<string, number>; // actionId → current daily value
}

export interface PortalStats {
  todayScore: number;
  weekScore: number;
  totalScore: number;
  currentStreak: number;
  bestStreak: number;
  dailyTrend: { date: string; points: number }[];
  groupLeaderboard: {
    participantId: string;
    firstName: string;
    lastName: string | null;
    totalScore: number;
    todayScore: number;
    rank: number;
    isMe: boolean;
  }[];
}

export interface PortalFeedItem {
  id: string;
  message: string;
  points: number;
  createdAt: string;
  participant: { id: string; firstName: string; lastName: string | null };
}

export interface PortalRules {
  programRulesContent: string | null;
  rulesPublished: boolean;
  actions: {
    id: string;
    name: string;
    description: string | null;
    explanationContent: string | null;
    points: number;
    inputType: string | null;
    unit: string | null;
    maxPerDay: number | null;
    aggregationMode: string;
  }[];
  rules: {
    id: string;
    name: string;
    type: string;
    conditionJson: unknown;
    rewardJson: unknown;
    isActive: boolean;
  }[];
}

@Injectable()
export class ParticipantPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gameEngine: GameEngineService,
  ) {}

  // ─── Resolve token → participant context ──────────────────────────────────

  async getContext(token: string, bypassSig?: string): Promise<PortalContext> {
    // Validate bypass sig (HMAC-SHA256 of the access token, first 24 hex chars)
    let bypass = false;
    if (bypassSig) {
      const secret = process.env.BYPASS_SECRET ?? 'challenge-bypass-dev-secret';
      const expected = createHmac('sha256', secret).update(token).digest('hex').slice(0, 24);
      bypass = bypassSig === expected;
    }
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
          // portalCallTime + portalOpenTime are on Group — included via the relation above
        },
      },
    });

    if (!pg || !pg.isActive) throw new NotFoundException('הקישור אינו בתוקף');
    if (!pg.group.programId || !pg.group.program) throw new NotFoundException('לא נמצאה תוכנית');
    if (!pg.group.program.isActive) throw new BadRequestException('program_inactive');

    const programId = pg.group.programId;

    const actions = await this.prisma.gameAction.findMany({
      where: { programId, isActive: true, showInPortal: true },
      orderBy: { sortOrder: 'asc' },
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
      // bypass=true: return null times so the frontend skips the opening gate (admin preview only)
      portalCallTime: bypass ? null : (pg.group.portalCallTime ? pg.group.portalCallTime.toISOString() : null),
      portalOpenTime: bypass ? null : (pg.group.portalOpenTime ? pg.group.portalOpenTime.toISOString() : null),
      actions,
      todayScore: scoreAgg._sum.points ?? 0,
      todayValues,
    };
  }

  // ─── Log action ────────────────────────────────────────────────────────────

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

  // ─── Stats tab ─────────────────────────────────────────────────────────────

  async getPortalStats(token: string): Promise<PortalStats> {
    const pg = await this.resolveToken(token);
    const { participantId, programId, groupId } = pg;

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);

    // Personal scores + streak (computed live so it's always consistent with actual ScoreEvent data)
    const [todayAgg, weekAgg, totalAgg, streak] = await Promise.all([
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, programId, createdAt: { gte: todayStart } } }),
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, programId, createdAt: { gte: weekStart } } }),
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, programId } }),
      this.gameEngine.getStreakLive(participantId, programId),
    ]);

    // 14-day daily trend
    const dailyTrend = await this.buildDailyTrend(participantId, programId, 14);

    // Group leaderboard
    const members = await this.prisma.participantGroup.findMany({
      where: { groupId, isActive: true },
      include: { participant: { select: { id: true, firstName: true, lastName: true } } },
    });

    const participantIds = members.map((m) => m.participantId);
    const memberTotals = await this.prisma.scoreEvent.groupBy({
      by: ['participantId'],
      where: { groupId, participantId: { in: participantIds } },
      _sum: { points: true },
    });
    const memberTodayTotals = await this.prisma.scoreEvent.groupBy({
      by: ['participantId'],
      where: { groupId, participantId: { in: participantIds }, createdAt: { gte: todayStart } },
      _sum: { points: true },
    });

    const totalsMap = Object.fromEntries(memberTotals.map((r) => [r.participantId, r._sum.points ?? 0]));
    const todayMap = Object.fromEntries(memberTodayTotals.map((r) => [r.participantId, r._sum.points ?? 0]));

    const leaderboard = members
      .map((m) => ({
        participantId: m.participantId,
        firstName: m.participant.firstName,
        lastName: m.participant.lastName ?? null,
        totalScore: totalsMap[m.participantId] ?? 0,
        todayScore: todayMap[m.participantId] ?? 0,
        isMe: m.participantId === participantId,
      }))
      .sort((a, b) => b.totalScore - a.totalScore)
      .map((r, i) => ({ ...r, rank: i + 1 }));

    return {
      todayScore: todayAgg._sum.points ?? 0,
      weekScore: weekAgg._sum.points ?? 0,
      totalScore: totalAgg._sum.points ?? 0,
      currentStreak: streak.currentStreak,
      bestStreak: streak.bestStreak,
      dailyTrend,
      groupLeaderboard: leaderboard,
    };
  }

  // ─── Feed tab ──────────────────────────────────────────────────────────────

  async getPortalFeed(token: string): Promise<PortalFeedItem[]> {
    const pg = await this.resolveToken(token);
    const events = await this.prisma.feedEvent.findMany({
      where: { groupId: pg.groupId, isPublic: true },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        participant: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return events.map((e) => ({
      id: e.id,
      message: e.message,
      points: e.points,
      createdAt: e.createdAt.toISOString(),
      participant: e.participant,
    }));
  }

  // ─── Rules tab ─────────────────────────────────────────────────────────────

  async getPortalRules(token: string): Promise<PortalRules> {
    const pg = await this.resolveToken(token);
    const { programId } = pg;

    const [program, actions, rules] = await Promise.all([
      this.prisma.program.findUnique({ where: { id: programId }, select: { rulesContent: true, rulesPublished: true } }),
      this.prisma.gameAction.findMany({
        where: { programId, isActive: true, showInPortal: true },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, description: true, explanationContent: true, points: true, inputType: true, unit: true, maxPerDay: true, aggregationMode: true },
      }),
      this.prisma.gameRule.findMany({
        where: { programId },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, type: true, conditionJson: true, rewardJson: true, isActive: true },
      }),
    ]);

    const published = program?.rulesPublished ?? false;
    return {
      programRulesContent: published ? (program?.rulesContent ?? null) : null,
      rulesPublished: published,
      actions,
      rules,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async resolveToken(token: string) {
    const pg = await this.prisma.participantGroup.findUnique({
      where: { accessToken: token },
      select: { participantId: true, groupId: true, isActive: true, group: { select: { programId: true } } },
    });
    if (!pg || !pg.isActive) throw new NotFoundException('הקישור אינו בתוקף');
    if (!pg.group.programId) throw new NotFoundException('לא נמצאה תוכנית');
    return { participantId: pg.participantId, groupId: pg.groupId, programId: pg.group.programId };
  }

  private async buildDailyTrend(participantId: string, programId: string, days: number): Promise<{ date: string; points: number }[]> {
    const now = new Date();
    const since = new Date(now);
    since.setDate(now.getDate() - days + 1);
    since.setHours(0, 0, 0, 0);

    const events = await this.prisma.scoreEvent.findMany({
      where: { participantId, programId, createdAt: { gte: since } },
      select: { points: true, createdAt: true },
    });

    // Build date → points map
    const map: Record<string, number> = {};
    for (const e of events) {
      const key = e.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
      map[key] = (map[key] ?? 0) + e.points;
    }

    // Fill all days in range (including zeros)
    const result: { date: string; points: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, points: map[key] ?? 0 });
    }
    return result;
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
