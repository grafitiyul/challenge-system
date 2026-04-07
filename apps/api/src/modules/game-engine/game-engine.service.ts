import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateActionDto, UpdateActionDto } from './dto/create-action.dto';
import { CreateRuleDto, UpdateRuleDto } from './dto/create-rule.dto';
import { LogActionDto } from './dto/log-action.dto';
import { EvaluateRulesDto } from './dto/evaluate-rules.dto';
import { UnlockRuleDto } from './dto/unlock-rule.dto';
import { InitGroupStateDto } from './dto/init-group-state.dto';

@Injectable()
export class GameEngineService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Actions CRUD ──────────────────────────────────────────────────────────

  listActions(programId: string) {
    return this.prisma.gameAction.findMany({
      where: { programId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  createAction(programId: string, dto: CreateActionDto) {
    return this.prisma.gameAction.create({
      data: {
        programId,
        name: dto.name,
        description: dto.description ?? null,
        inputType: dto.inputType ?? 'boolean',
        points: dto.points,
        maxPerDay: dto.maxPerDay ?? null,
      },
    });
  }

  async updateAction(actionId: string, dto: UpdateActionDto) {
    const action = await this.prisma.gameAction.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException(`Action ${actionId} not found`);
    return this.prisma.gameAction.update({
      where: { id: actionId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.inputType !== undefined ? { inputType: dto.inputType } : {}),
        ...(dto.points !== undefined ? { points: dto.points } : {}),
        ...(dto.maxPerDay !== undefined ? { maxPerDay: dto.maxPerDay } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // ─── Rules CRUD ────────────────────────────────────────────────────────────

  listRules(programId: string) {
    return this.prisma.gameRule.findMany({
      where: { programId },
      orderBy: { createdAt: 'asc' },
    });
  }

  createRule(programId: string, dto: CreateRuleDto) {
    return this.prisma.gameRule.create({
      data: {
        programId,
        name: dto.name,
        type: dto.type,
        conditionJson: (dto.conditionJson as object) ?? {},
        rewardJson: (dto.rewardJson as object) ?? { points: 0 },
        activationType: dto.activationType ?? 'immediate',
        activationDays: dto.activationDays ?? null,
        requiresAdminApproval: dto.requiresAdminApproval ?? false,
      },
    });
  }

  async updateRule(ruleId: string, dto: UpdateRuleDto) {
    const rule = await this.prisma.gameRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException(`Rule ${ruleId} not found`);
    return this.prisma.gameRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.conditionJson !== undefined ? { conditionJson: dto.conditionJson as object } : {}),
        ...(dto.rewardJson !== undefined ? { rewardJson: dto.rewardJson as object } : {}),
        ...(dto.activationType !== undefined ? { activationType: dto.activationType } : {}),
        ...(dto.activationDays !== undefined ? { activationDays: dto.activationDays } : {}),
        ...(dto.requiresAdminApproval !== undefined ? { requiresAdminApproval: dto.requiresAdminApproval } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // ─── Log action (core write path) ──────────────────────────────────────────

  async logAction(dto: LogActionDto) {
    const action = await this.prisma.gameAction.findUnique({ where: { id: dto.actionId } });
    if (!action) throw new NotFoundException(`Action ${dto.actionId} not found`);
    if (!action.isActive) throw new BadRequestException('Action is inactive');
    if (action.programId !== dto.programId) throw new BadRequestException('Action does not belong to this program');

    // Enforce maxPerDay
    if (action.maxPerDay !== null) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayCount = await this.prisma.userActionLog.count({
        where: {
          participantId: dto.participantId,
          actionId: dto.actionId,
          createdAt: { gte: todayStart },
        },
      });
      if (todayCount >= action.maxPerDay) {
        throw new BadRequestException(`Max ${action.maxPerDay} logs per day reached for this action`);
      }
    }

    const now = new Date();

    // 1. Create the log entry
    const log = await this.prisma.userActionLog.create({
      data: {
        participantId: dto.participantId,
        programId: dto.programId,
        actionId: dto.actionId,
        value: dto.value ?? 'true',
      },
    });

    // 2. Create ledger ScoreEvent
    const scoreEvent = await this.prisma.scoreEvent.create({
      data: {
        participantId: dto.participantId,
        programId: dto.programId,
        groupId: dto.groupId ?? null,
        sourceType: 'action',
        sourceId: dto.actionId,
        points: action.points,
        metadata: { logId: log.id, actionName: action.name, value: dto.value ?? 'true' },
      },
    });

    // 3. Update participant game state (streak + lastActionDate)
    await this.updateParticipantStreak(dto.participantId, dto.programId, now);

    // 4. Create feed event (if groupId provided)
    if (dto.groupId) {
      await this.prisma.feedEvent.create({
        data: {
          participantId: dto.participantId,
          groupId: dto.groupId,
          programId: dto.programId,
          type: 'action',
          message: `דיווחה על: ${action.name}`,
          points: action.points,
          isPublic: true,
        },
      });
    }

    // 5. Trigger rule evaluation
    const ruleResults = await this.evaluateRules({
      participantId: dto.participantId,
      programId: dto.programId,
      groupId: dto.groupId,
    });

    return { log, scoreEvent, ruleResults };
  }

  // ─── Rule evaluation ───────────────────────────────────────────────────────

  async evaluateRules(dto: EvaluateRulesDto) {
    const rules = await this.prisma.gameRule.findMany({
      where: { programId: dto.programId, isActive: true },
    });

    const groupDay = dto.groupId ? await this.getGroupDay(dto.groupId) : null;
    const state = await this.getOrCreateParticipantState(dto.participantId, dto.programId);
    const results: { ruleId: string; fired: boolean; reason?: string; points?: number }[] = [];

    for (const rule of rules) {
      // ── Activation gate ──────────────────────────────────────────────────
      if (rule.activationType === 'after_days') {
        if (groupDay === null || groupDay < (rule.activationDays ?? 0)) {
          results.push({ ruleId: rule.id, fired: false, reason: 'activation_days_not_reached' });
          continue;
        }
      }

      if (rule.activationType === 'admin_unlock' || rule.requiresAdminApproval) {
        if (!dto.groupId) {
          results.push({ ruleId: rule.id, fired: false, reason: 'no_group_for_unlock_check' });
          continue;
        }
        const unlock = await this.prisma.groupRuleUnlock.findUnique({
          where: { groupId_ruleId: { groupId: dto.groupId, ruleId: rule.id } },
        });
        if (!unlock) {
          results.push({ ruleId: rule.id, fired: false, reason: 'not_admin_unlocked' });
          continue;
        }
      }

      // ── Condition evaluation ─────────────────────────────────────────────
      const condition = rule.conditionJson as Record<string, unknown>;
      const reward = rule.rewardJson as Record<string, unknown>;
      const rewardPoints = typeof reward['points'] === 'number' ? reward['points'] : 0;

      let conditionMet = false;

      if (rule.type === 'daily_bonus') {
        // Fires once per day for active participants
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const alreadyGiven = await this.prisma.scoreEvent.count({
          where: {
            participantId: dto.participantId,
            programId: dto.programId,
            sourceType: 'rule',
            sourceId: rule.id,
            createdAt: { gte: todayStart },
          },
        });
        conditionMet = alreadyGiven === 0;

      } else if (rule.type === 'streak') {
        const minStreak = typeof condition['minStreak'] === 'number' ? condition['minStreak'] : 1;
        conditionMet = state.currentStreak >= minStreak;
        // Only award once per streak milestone (check today)
        if (conditionMet) {
          const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
          const alreadyGiven = await this.prisma.scoreEvent.count({
            where: {
              participantId: dto.participantId,
              programId: dto.programId,
              sourceType: 'rule',
              sourceId: rule.id,
              createdAt: { gte: todayStart },
            },
          });
          conditionMet = alreadyGiven === 0;
        }

      } else if (rule.type === 'conditional') {
        // Flexible: checks if participant logged a specific action today
        const requiredActionId = typeof condition['actionId'] === 'string' ? condition['actionId'] : null;
        if (requiredActionId) {
          const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
          const logged = await this.prisma.userActionLog.count({
            where: {
              participantId: dto.participantId,
              programId: dto.programId,
              actionId: requiredActionId,
              createdAt: { gte: todayStart },
            },
          });
          conditionMet = logged > 0;
        }
      }

      if (!conditionMet) {
        results.push({ ruleId: rule.id, fired: false, reason: 'condition_not_met' });
        continue;
      }

      // ── Fire the rule: create ScoreEvent ─────────────────────────────────
      await this.prisma.scoreEvent.create({
        data: {
          participantId: dto.participantId,
          programId: dto.programId,
          groupId: dto.groupId ?? null,
          sourceType: 'rule',
          sourceId: rule.id,
          points: rewardPoints,
          metadata: { ruleName: rule.name, ruleType: rule.type },
        },
      });

      if (dto.groupId && rewardPoints > 0) {
        await this.prisma.feedEvent.create({
          data: {
            participantId: dto.participantId,
            groupId: dto.groupId,
            programId: dto.programId,
            type: 'rare',
            message: `קיבלה בונוס: ${rule.name}`,
            points: rewardPoints,
            isPublic: true,
          },
        });
      }

      results.push({ ruleId: rule.id, fired: true, points: rewardPoints });
    }

    return results;
  }

  // ─── Score summary ─────────────────────────────────────────────────────────

  async getScoreSummary(participantId: string, programId: string) {
    const now = new Date();

    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [todayRows, weekRows, monthRows, totalRows] = await Promise.all([
      this.prisma.scoreEvent.aggregate({
        _sum: { points: true },
        where: { participantId, programId, createdAt: { gte: todayStart } },
      }),
      this.prisma.scoreEvent.aggregate({
        _sum: { points: true },
        where: { participantId, programId, createdAt: { gte: weekStart } },
      }),
      this.prisma.scoreEvent.aggregate({
        _sum: { points: true },
        where: { participantId, programId, createdAt: { gte: monthStart } },
      }),
      this.prisma.scoreEvent.aggregate({
        _sum: { points: true },
        where: { participantId, programId },
      }),
    ]);

    const state = await this.getOrCreateParticipantState(participantId, programId);

    return {
      todayScore: todayRows._sum.points ?? 0,
      weekScore: weekRows._sum.points ?? 0,
      monthScore: monthRows._sum.points ?? 0,
      totalScore: totalRows._sum.points ?? 0,
      currentStreak: state.currentStreak,
      bestStreak: state.bestStreak,
    };
  }

  // ─── Feed ──────────────────────────────────────────────────────────────────

  getFeed(groupId: string, limit = 20) {
    return this.prisma.feedEvent.findMany({
      where: { groupId, isPublic: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        participant: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  // ─── Admin: unlock rule ────────────────────────────────────────────────────

  async unlockRule(dto: UnlockRuleDto) {
    const [rule, group] = await Promise.all([
      this.prisma.gameRule.findUnique({ where: { id: dto.ruleId } }),
      this.prisma.group.findUnique({ where: { id: dto.groupId } }),
    ]);
    if (!rule) throw new NotFoundException(`Rule ${dto.ruleId} not found`);
    if (!group) throw new NotFoundException(`Group ${dto.groupId} not found`);

    // Upsert: safe to call multiple times
    return this.prisma.groupRuleUnlock.upsert({
      where: { groupId_ruleId: { groupId: dto.groupId, ruleId: dto.ruleId } },
      create: { groupId: dto.groupId, ruleId: dto.ruleId, unlockedBy: dto.unlockedBy ?? null },
      update: { unlockedAt: new Date(), unlockedBy: dto.unlockedBy ?? null },
    });
  }

  // ─── Group game state ──────────────────────────────────────────────────────

  async initGroupState(dto: InitGroupStateDto) {
    return this.prisma.groupGameState.upsert({
      where: { groupId: dto.groupId },
      create: { groupId: dto.groupId, startDate: new Date(dto.startDate), currentDay: 1 },
      update: { startDate: new Date(dto.startDate) },
    });
  }

  async getGroupState(groupId: string) {
    const state = await this.prisma.groupGameState.findUnique({ where: { groupId } });
    if (!state) return null;
    // Compute current day from startDate
    const diffMs = Date.now() - state.startDate.getTime();
    const currentDay = Math.max(1, Math.floor(diffMs / 86_400_000) + 1);
    if (state.currentDay !== currentDay) {
      await this.prisma.groupGameState.update({
        where: { groupId },
        data: { currentDay },
      });
    }
    return { ...state, currentDay };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async getGroupDay(groupId: string): Promise<number | null> {
    const state = await this.getGroupState(groupId);
    return state ? state.currentDay : null;
  }

  private async getOrCreateParticipantState(participantId: string, programId: string) {
    return this.prisma.participantGameState.upsert({
      where: { participantId_programId: { participantId, programId } },
      create: { participantId, programId },
      update: {},
    });
  }

  private async updateParticipantStreak(participantId: string, programId: string, now: Date) {
    const state = await this.getOrCreateParticipantState(participantId, programId);

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    let newStreak = state.currentStreak;

    if (!state.lastActionDate) {
      newStreak = 1;
    } else {
      const last = new Date(state.lastActionDate);
      last.setHours(0, 0, 0, 0);

      if (last.getTime() === today.getTime()) {
        // Already logged today — streak unchanged
        return;
      } else if (last.getTime() === yesterday.getTime()) {
        // Consecutive day — extend streak
        newStreak = state.currentStreak + 1;
      } else {
        // Gap — reset streak
        newStreak = 1;
      }
    }

    const newBest = Math.max(state.bestStreak, newStreak);

    await this.prisma.participantGameState.update({
      where: { participantId_programId: { participantId, programId } },
      data: { currentStreak: newStreak, bestStreak: newBest, lastActionDate: now },
    });
  }
}
