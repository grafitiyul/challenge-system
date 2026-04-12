import { createHmac } from 'crypto';
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
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createAction(programId: string, dto: CreateActionDto) {
    const count = await this.prisma.gameAction.count({ where: { programId } });
    return this.prisma.gameAction.create({
      data: {
        programId,
        name: dto.name,
        description: dto.description ?? null,
        inputType: dto.inputType ?? 'boolean',
        aggregationMode: dto.aggregationMode ?? 'none',
        unit: dto.unit ?? null,
        points: dto.points,
        maxPerDay: dto.maxPerDay ?? null,
        showInPortal: dto.showInPortal ?? true,
        blockedMessage: dto.blockedMessage ?? null,
        explanationContent: dto.explanationContent ?? null,
        sortOrder: count,
      },
    });
  }

  async reorderActions(programId: string, items: { id: string; sortOrder: number }[]) {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.gameAction.update({
          where: { id: item.id, programId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }

  async deleteAction(actionId: string) {
    const action = await this.prisma.gameAction.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException(`Action ${actionId} not found`);
    // Soft-delete: logs/score-events reference this action
    return this.prisma.gameAction.update({ where: { id: actionId }, data: { isActive: false } });
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
        ...(dto.aggregationMode !== undefined ? { aggregationMode: dto.aggregationMode } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
        ...(dto.points !== undefined ? { points: dto.points } : {}),
        ...(dto.maxPerDay !== undefined ? { maxPerDay: dto.maxPerDay } : {}),
        ...(dto.showInPortal !== undefined ? { showInPortal: dto.showInPortal } : {}),
        ...(dto.blockedMessage !== undefined ? { blockedMessage: dto.blockedMessage } : {}),
        ...(dto.explanationContent !== undefined ? { explanationContent: dto.explanationContent } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // ─── Rules CRUD ────────────────────────────────────────────────────────────

  listRules(programId: string) {
    return this.prisma.gameRule.findMany({
      where: { programId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createRule(programId: string, dto: CreateRuleDto) {
    const count = await this.prisma.gameRule.count({ where: { programId } });
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
        sortOrder: count,
      },
    });
  }

  async reorderRules(programId: string, items: { id: string; sortOrder: number }[]) {
    await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.gameRule.update({
          where: { id: item.id, programId },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
  }

  async deleteRule(ruleId: string) {
    const rule = await this.prisma.gameRule.findUnique({ where: { id: ruleId } });
    if (!rule) throw new NotFoundException(`Rule ${ruleId} not found`);
    // Soft-delete: score-events reference this rule
    return this.prisma.gameRule.update({ where: { id: ruleId }, data: { isActive: false } });
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
        const msg = action.blockedMessage?.trim() ||
          (action.maxPerDay === 1
            ? 'כבר ביצעת פעולה זו היום. ניתן לדווח שוב מחר.'
            : `כבר הגעת למכסה היומית לפעולה זו (${action.maxPerDay} פעמים). ניתן לדווח שוב מחר.`);
        throw new BadRequestException(msg);
      }
    }

    // For latest_value numeric actions: enforce monotonic daily increase.
    // Participant reports their CURRENT running total — it cannot go down within a day.
    if (action.inputType === 'number' && action.aggregationMode === 'latest_value') {
      const numericValue = parseFloat(dto.value ?? '');
      if (isNaN(numericValue) || numericValue < 0) {
        throw new BadRequestException('ערך מספרי חוקי נדרש עבור פעולה זו');
      }
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const currentEffective = await this.getEffectiveDailyValue(
        dto.participantId, dto.programId, dto.actionId, todayStart,
      );
      if (numericValue < currentEffective) {
        throw new BadRequestException(
          `הערך ${numericValue} נמוך מהסה"כ היומי הנוכחי (${currentEffective}). ` +
          `עבור פעולות "ערך שוטף", יש לדווח על הסה"כ הנוכחי — הערך לא יכול לרדת.`,
        );
      }
    }

    const now = new Date();

    // For incremental_sum numeric actions, action.points is "per unit".
    // Multiply by the quantity submitted to get total points for this entry.
    // For all other action types (boolean, latest_value), use action.points as-is.
    let pointsForThisLog = action.points;
    if (action.inputType === 'number' && action.aggregationMode === 'incremental_sum') {
      const qty = parseFloat(dto.value ?? '0');
      if (!isNaN(qty) && qty > 0) {
        pointsForThisLog = Math.round(action.points * qty);
      }
    }

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
        points: pointsForThisLog,
        metadata: { logId: log.id, actionName: action.name, value: dto.value ?? 'true' },
      },
    });

    // 3. Update participant game state (streak + lastActionDate)
    await this.updateParticipantStreak(dto.participantId, dto.programId, now);

    // 4. Create feed event (if groupId provided)
    if (dto.groupId) {
      const hasNumericValue = action.inputType === 'number' && dto.value && dto.value !== 'true';
      const valueStr = hasNumericValue
        ? `: ${dto.value}${action.unit ? ` ${action.unit}` : ''}`
        : '';
      await this.prisma.feedEvent.create({
        data: {
          participantId: dto.participantId,
          groupId: dto.groupId,
          programId: dto.programId,
          type: 'action',
          message: `דיווחה על ${action.name}${valueStr}`,
          points: pointsForThisLog,
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
    const allRules = await this.prisma.gameRule.findMany({
      where: { programId: dto.programId, isActive: true },
    });

    // Sort threshold-bearing conditional rules for the same action ascending by threshold.
    // This guarantees that within a single evaluateRules call, lower thresholds are always
    // committed to the DB before higher ones. The ladder-delta query then sees earlier
    // firings correctly, regardless of how the admin defined the rules.
    const rules = [...allRules].sort((a, b) => {
      if (a.type !== 'conditional' || b.type !== 'conditional') return 0;
      const ca = a.conditionJson as Record<string, unknown>;
      const cb = b.conditionJson as Record<string, unknown>;
      const ta = typeof ca['threshold'] === 'number' ? (ca['threshold'] as number) : null;
      const tb = typeof cb['threshold'] === 'number' ? (cb['threshold'] as number) : null;
      if (ta !== null && tb !== null && ca['actionId'] === cb['actionId']) return ta - tb;
      return 0;
    });

    // Single todayStart for the entire evaluation — consistent across all rule checks.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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
      // pointsToAward defaults to full rewardPoints; overridden for threshold-ladder rules
      let pointsToAward = rewardPoints;

      if (rule.type === 'daily_bonus') {
        // Fires once per day for any participant who submitted an action
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
        // Award at most once per day per streak milestone
        if (conditionMet) {
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
        const requiredActionId = typeof condition['actionId'] === 'string' ? condition['actionId'] : null;
        if (requiredActionId) {
          const threshold =
            typeof condition['threshold'] === 'number' ? (condition['threshold'] as number) : null;

          if (threshold !== null) {
            // ── Threshold mode ───────────────────────────────────────────
            // Compare the participant's effective daily value against the threshold.
            // "effective daily value" depends on the action's aggregationMode:
            //   latest_value    → max of all submitted values today
            //   incremental_sum → sum of all submitted values today
            const effectiveValue = await this.getEffectiveDailyValue(
              dto.participantId, dto.programId, requiredActionId, todayStart,
            );
            conditionMet = effectiveValue >= threshold;
          } else {
            // ── Presence mode (original behavior) ───────────────────────
            // Fires when the participant has logged the action at least once today.
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

          // Dedup: fire at most once per day per rule (applies to both threshold and presence).
          // This was missing for conditional rules before — it is now enforced consistently.
          if (conditionMet) {
            const alreadyFired = await this.prisma.scoreEvent.count({
              where: {
                participantId: dto.participantId,
                programId: dto.programId,
                sourceType: 'rule',
                sourceId: rule.id,
                createdAt: { gte: todayStart },
              },
            });
            if (alreadyFired > 0) conditionMet = false;
          }

          // ── Ladder delta for threshold rules ─────────────────────────
          // rewardJson.points is the CUMULATIVE total deserved at this threshold level.
          // To prevent double-awarding across the ladder, award only the delta above
          // what has already been earned from ALL threshold rules for the same action today.
          //
          // Example ladder: 3000→10pts, 5000→20pts, 10000→40pts
          //   submit 3000: alreadyEarned=0, delta=10-0=10  ✓
          //   submit 5000: alreadyEarned=10, delta=20-10=10 ✓
          //   submit 10000: alreadyEarned=20, delta=40-20=20 ✓
          if (conditionMet && threshold !== null) {
            const ladderRuleIds = rules
              .filter(r => {
                if (r.type !== 'conditional') return false;
                const c = r.conditionJson as Record<string, unknown>;
                return (
                  typeof c['actionId'] === 'string' &&
                  c['actionId'] === requiredActionId &&
                  typeof c['threshold'] === 'number'
                );
              })
              .map(r => r.id);

            const earned = await this.prisma.scoreEvent.aggregate({
              _sum: { points: true },
              where: {
                participantId: dto.participantId,
                programId: dto.programId,
                sourceType: 'rule',
                sourceId: { in: ladderRuleIds },
                createdAt: { gte: todayStart },
              },
            });

            const alreadyEarned = earned._sum.points ?? 0;
            const delta = rewardPoints - alreadyEarned;

            if (delta <= 0) {
              conditionMet = false; // nothing new to award at this level
            } else {
              pointsToAward = delta; // award only the marginal difference
            }
          }
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
          points: pointsToAward,
          metadata: { ruleName: rule.name, ruleType: rule.type },
        },
      });

      if (dto.groupId && pointsToAward > 0) {
        await this.prisma.feedEvent.create({
          data: {
            participantId: dto.participantId,
            groupId: dto.groupId,
            programId: dto.programId,
            type: 'rare',
            message: `קיבלה בונוס: ${rule.name}`,
            points: pointsToAward,
            isPublic: true,
          },
        });
      }

      results.push({ ruleId: rule.id, fired: true, points: pointsToAward });
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

  // ─── Leaderboard ──────────────────────────────────────────────────────────────

  async getGroupLeaderboard(groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { programId: true },
    });
    if (!group) throw new NotFoundException(`Group ${groupId} not found`);

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);

    const members = await this.prisma.participantGroup.findMany({
      where: { groupId, isActive: true },
      include: { participant: { select: { id: true, firstName: true, lastName: true } } },
    });

    if (members.length === 0) return [];

    const participantIds = members.map((m) => m.participantId);

    const [totals, todayTotals, weekTotals, streaks] = await Promise.all([
      this.prisma.scoreEvent.groupBy({
        by: ['participantId'],
        where: { groupId, participantId: { in: participantIds } },
        _sum: { points: true },
      }),
      this.prisma.scoreEvent.groupBy({
        by: ['participantId'],
        where: { groupId, participantId: { in: participantIds }, createdAt: { gte: todayStart } },
        _sum: { points: true },
      }),
      this.prisma.scoreEvent.groupBy({
        by: ['participantId'],
        where: { groupId, participantId: { in: participantIds }, createdAt: { gte: weekStart } },
        _sum: { points: true },
      }),
      group.programId
        ? this.prisma.participantGameState.findMany({
            where: { programId: group.programId, participantId: { in: participantIds } },
            select: { participantId: true, currentStreak: true },
          })
        : Promise.resolve([]),
    ]);

    const totalsMap = Object.fromEntries(totals.map((r) => [r.participantId, r._sum.points ?? 0]));
    const todayMap = Object.fromEntries(todayTotals.map((r) => [r.participantId, r._sum.points ?? 0]));
    const weekMap = Object.fromEntries(weekTotals.map((r) => [r.participantId, r._sum.points ?? 0]));
    const streakMap = Object.fromEntries((streaks as { participantId: string; currentStreak: number }[]).map((r) => [r.participantId, r.currentStreak]));

    const rows = members.map((m) => ({
      participantId: m.participantId,
      firstName: m.participant.firstName,
      lastName: m.participant.lastName ?? null,
      totalScore: totalsMap[m.participantId] ?? 0,
      todayScore: todayMap[m.participantId] ?? 0,
      weekScore: weekMap[m.participantId] ?? 0,
      currentStreak: streakMap[m.participantId] ?? 0,
    }));

    rows.sort((a, b) => b.totalScore - a.totalScore);
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  async getProgramGroupRanking(programId: string) {
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { id: true },
    });
    if (!program) throw new NotFoundException(`Program ${programId} not found`);

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);

    const groups = await this.prisma.group.findMany({
      where: { programId, isActive: true },
      select: { id: true, name: true },
    });

    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.id);

    const [totals, todayTotals, weekTotals, memberCounts] = await Promise.all([
      this.prisma.scoreEvent.groupBy({
        by: ['groupId'],
        where: { groupId: { in: groupIds } },
        _sum: { points: true },
      }),
      this.prisma.scoreEvent.groupBy({
        by: ['groupId'],
        where: { groupId: { in: groupIds }, createdAt: { gte: todayStart } },
        _sum: { points: true },
      }),
      this.prisma.scoreEvent.groupBy({
        by: ['groupId'],
        where: { groupId: { in: groupIds }, createdAt: { gte: weekStart } },
        _sum: { points: true },
      }),
      this.prisma.participantGroup.groupBy({
        by: ['groupId'],
        where: { groupId: { in: groupIds }, isActive: true },
        _count: { participantId: true },
      }),
    ]);

    const totalsMap = Object.fromEntries(totals.map((r) => [r.groupId as string, r._sum.points ?? 0]));
    const todayMap = Object.fromEntries(todayTotals.map((r) => [r.groupId as string, r._sum.points ?? 0]));
    const weekMap = Object.fromEntries(weekTotals.map((r) => [r.groupId as string, r._sum.points ?? 0]));
    const countMap = Object.fromEntries(memberCounts.map((r) => [r.groupId, r._count.participantId]));

    const rows = groups.map((g) => {
      const total = totalsMap[g.id] ?? 0;
      const count = countMap[g.id] ?? 0;
      return {
        groupId: g.id,
        groupName: g.name,
        totalScore: total,
        todayScore: todayMap[g.id] ?? 0,
        weekScore: weekMap[g.id] ?? 0,
        participantCount: count,
        averageScorePerParticipant: count > 0 ? Math.round(total / count) : 0,
      };
    });

    rows.sort((a, b) => b.totalScore - a.totalScore);
    return rows.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  async getProgramSummary(programId: string) {
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { id: true },
    });
    if (!program) throw new NotFoundException(`Program ${programId} not found`);

    const [groupCount, participantCount, eventCount, groupTotals, participantTotals] = await Promise.all([
      this.prisma.group.count({ where: { programId, isActive: true } }),
      this.prisma.participantGameState.count({ where: { programId } }),
      this.prisma.scoreEvent.count({ where: { programId } }),
      // Group-level totals (only events with a groupId)
      this.prisma.scoreEvent.groupBy({
        by: ['groupId'],
        where: { programId, groupId: { not: null } },
        _sum: { points: true },
      }),
      // Participant-level totals
      this.prisma.scoreEvent.groupBy({
        by: ['participantId'],
        where: { programId },
        _sum: { points: true },
      }),
    ]);

    // Highest scoring group
    let highestScoringGroup: { groupId: string | null; groupName: string | null; totalScore: number } = {
      groupId: null, groupName: null, totalScore: 0,
    };
    if (groupTotals.length > 0) {
      const best = groupTotals.reduce((a, b) => (b._sum.points ?? 0) > (a._sum.points ?? 0) ? b : a);
      if (best.groupId) {
        const grp = await this.prisma.group.findUnique({ where: { id: best.groupId }, select: { name: true } });
        highestScoringGroup = { groupId: best.groupId, groupName: grp?.name ?? null, totalScore: best._sum.points ?? 0 };
      }
    }

    // Highest scoring participant
    let highestScoringParticipant: { participantId: string | null; firstName: string | null; totalScore: number } = {
      participantId: null, firstName: null, totalScore: 0,
    };
    if (participantTotals.length > 0) {
      const best = participantTotals.reduce((a, b) => (b._sum.points ?? 0) > (a._sum.points ?? 0) ? b : a);
      const p = await this.prisma.participant.findUnique({ where: { id: best.participantId }, select: { firstName: true } });
      highestScoringParticipant = { participantId: best.participantId, firstName: p?.firstName ?? null, totalScore: best._sum.points ?? 0 };
    }

    const totalScoreAll = participantTotals.reduce((s, r) => s + (r._sum.points ?? 0), 0);

    return {
      totalGroups: groupCount,
      totalParticipants: participantCount,
      totalScoreEvents: eventCount,
      highestScoringGroup,
      highestScoringParticipant,
      averageScorePerGroup: groupCount > 0 ? Math.round(totalScoreAll / groupCount) : 0,
      averageScorePerParticipant: participantCount > 0 ? Math.round(totalScoreAll / participantCount) : 0,
    };
  }

  // ─── Admin: participant stats (for group management panel) ───────────────────

  async getAdminParticipantStats(participantId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { programId: true },
    });
    if (!group?.programId) throw new NotFoundException('Group or program not found');
    const programId = group.programId;

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0, 0, 0, 0);
    const since14 = new Date(now); since14.setDate(now.getDate() - 13); since14.setHours(0, 0, 0, 0);

    // Score queries MUST use groupId, not programId.
    // A participant can belong to multiple groups under the same program.
    // Using programId would merge scores from all groups — wrong for the per-group inspect panel.
    // Streak (ParticipantGameState) is keyed by programId — intentionally program-level, not per group.
    const [todayAgg, weekAgg, totalAgg, state, trendEvents] = await Promise.all([
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, groupId, createdAt: { gte: todayStart } } }),
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, groupId, createdAt: { gte: weekStart } } }),
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, groupId } }),
      this.prisma.participantGameState.findUnique({ where: { participantId_programId: { participantId, programId } } }),
      this.prisma.scoreEvent.findMany({ where: { participantId, groupId, createdAt: { gte: since14 } }, select: { points: true, createdAt: true } }),
    ]);

    // Build 14-day trend
    const trendMap: Record<string, number> = {};
    for (const e of trendEvents) {
      const key = e.createdAt.toISOString().slice(0, 10);
      trendMap[key] = (trendMap[key] ?? 0) + e.points;
    }
    const dailyTrend: { date: string; points: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(since14); d.setDate(since14.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      dailyTrend.push({ date: key, points: trendMap[key] ?? 0 });
    }

    return {
      todayScore: todayAgg._sum.points ?? 0,
      weekScore: weekAgg._sum.points ?? 0,
      totalScore: totalAgg._sum.points ?? 0,
      currentStreak: state?.currentStreak ?? 0,
      bestStreak: state?.bestStreak ?? 0,
      dailyTrend,
    };
  }

  // ─── Admin: feed for one participant (with optional participantId filter) ─────

  getAdminFeed(groupId: string, participantId?: string, limit = 50) {
    return this.prisma.feedEvent.findMany({
      where: {
        groupId,
        isPublic: true,
        ...(participantId ? { participantId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        participant: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  // ─── Admin: delete feed event + matching score events ────────────────────────

  async deleteFeedEvent(feedEventId: string) {
    const event = await this.prisma.feedEvent.findUnique({ where: { id: feedEventId } });
    if (!event) throw new NotFoundException(`Feed event ${feedEventId} not found`);

    // Find score events created within a 10-second window around this feed event
    // with matching participantId + groupId + points. This covers both 'action' and
    // 'rule' feed events — each has exactly one corresponding ScoreEvent.
    const windowMs = 10_000;
    const windowStart = new Date(event.createdAt.getTime() - windowMs);
    const windowEnd = new Date(event.createdAt.getTime() + windowMs);

    const matchingScoreEvents = await this.prisma.scoreEvent.findMany({
      where: {
        participantId: event.participantId,
        groupId: event.groupId,
        points: event.points,
        createdAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, metadata: true },
    });

    // Extract UserActionLog IDs stored in ScoreEvent.metadata by logAction
    const logIds: string[] = matchingScoreEvents
      .map((se) => {
        const meta = se.metadata as Record<string, unknown> | null;
        return typeof meta?.['logId'] === 'string' ? meta['logId'] : null;
      })
      .filter((id): id is string => id !== null);

    // Delete in a transaction: feed event, score events, and orphaned action logs
    await this.prisma.$transaction([
      this.prisma.feedEvent.delete({ where: { id: feedEventId } }),
      ...matchingScoreEvents.map((se) =>
        this.prisma.scoreEvent.delete({ where: { id: se.id } }),
      ),
      ...(logIds.length > 0
        ? [this.prisma.userActionLog.deleteMany({ where: { id: { in: logIds } } })]
        : []),
    ]);

    // Recompute streak from scratch so deletion cascades to participant state
    const programId = event.programId;
    if (programId) {
      await this.recomputeParticipantStreak(event.participantId, programId);
    }

    return { deleted: true, scoreEventsRemoved: matchingScoreEvents.length };
  }

  // ─── Admin: bulk delete feed events ──────────────────────────────────────────

  async bulkDeleteFeedEvents(feedEventIds: string[]) {
    // Collect all events first so we know which participants need recompute
    const events = await this.prisma.feedEvent.findMany({
      where: { id: { in: feedEventIds } },
      select: { id: true, participantId: true, programId: true, groupId: true, points: true, createdAt: true },
    });

    let totalScoreEventsRemoved = 0;
    const affectedPairs = new Map<string, { participantId: string; programId: string }>();

    for (const event of events) {
      const windowMs = 10_000;
      const windowStart = new Date(event.createdAt.getTime() - windowMs);
      const windowEnd = new Date(event.createdAt.getTime() + windowMs);

      const matchingScoreEvents = await this.prisma.scoreEvent.findMany({
        where: {
          participantId: event.participantId,
          groupId: event.groupId,
          points: event.points,
          createdAt: { gte: windowStart, lte: windowEnd },
        },
        select: { id: true, metadata: true },
      });

      const logIds: string[] = matchingScoreEvents
        .map((se) => {
          const meta = se.metadata as Record<string, unknown> | null;
          return typeof meta?.['logId'] === 'string' ? meta['logId'] : null;
        })
        .filter((id): id is string => id !== null);

      await this.prisma.$transaction([
        this.prisma.feedEvent.delete({ where: { id: event.id } }),
        ...matchingScoreEvents.map((se) =>
          this.prisma.scoreEvent.delete({ where: { id: se.id } }),
        ),
        ...(logIds.length > 0
          ? [this.prisma.userActionLog.deleteMany({ where: { id: { in: logIds } } })]
          : []),
      ]);

      totalScoreEventsRemoved += matchingScoreEvents.length;

      if (event.programId) {
        const key = `${event.participantId}:${event.programId}`;
        affectedPairs.set(key, { participantId: event.participantId, programId: event.programId });
      }
    }

    // Recompute streak once per affected participant (not once per deleted event)
    await Promise.all(
      Array.from(affectedPairs.values()).map(({ participantId, programId }) =>
        this.recomputeParticipantStreak(participantId, programId),
      ),
    );

    return { deleted: feedEventIds.length, scoreEventsRemoved: totalScoreEventsRemoved };
  }

  // ─── Admin: reset all progress for a participant in a group ──────────────────

  async resetParticipantProgress(participantId: string, groupId: string) {
    const group = await this.prisma.group.findUnique({
      where: { id: groupId },
      select: { programId: true },
    });
    if (!group) throw new NotFoundException(`Group ${groupId} not found`);
    const { programId } = group;

    await this.prisma.$transaction([
      // Delete all feed events for this participant in this group
      this.prisma.feedEvent.deleteMany({ where: { participantId, groupId } }),
      // Delete all score events for this participant in this program (scoped to group too)
      this.prisma.scoreEvent.deleteMany({ where: { participantId, groupId } }),
      // Delete all action logs for this participant in this program
      this.prisma.userActionLog.deleteMany({ where: { participantId, programId } }),
    ]);

    // Reset game state completely
    await this.prisma.participantGameState.upsert({
      where: { participantId_programId: { participantId, programId } },
      create: { participantId, programId, currentStreak: 0, bestStreak: 0, lastActionDate: null },
      update: { currentStreak: 0, bestStreak: 0, lastActionDate: null },
    });

    return { reset: true, participantId, groupId, programId };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  // ─── Effective daily value ──────────────────────────────────────────────────

  /**
   * Returns the effective daily value for a numeric action.
   *
   * latest_value    → maximum of all values submitted today (participant reports running total)
   * incremental_sum → sum of all values submitted today (participant reports what they added now)
   * none / non-numeric → 0 (not applicable)
   *
   * This is the value that threshold rules evaluate against. It is also used by logAction
   * to enforce the monotonic-increase constraint for latest_value actions.
   */
  private async getEffectiveDailyValue(
    participantId: string,
    programId: string,
    actionId: string,
    todayStart: Date,
  ): Promise<number> {
    const action = await this.prisma.gameAction.findUnique({ where: { id: actionId } });
    if (!action || action.inputType !== 'number') return 0;

    const logs = await this.prisma.userActionLog.findMany({
      where: { participantId, programId, actionId, createdAt: { gte: todayStart } },
    });

    const values = logs
      .map(l => parseFloat(l.value))
      .filter(v => !isNaN(v) && v >= 0);

    if (values.length === 0) return 0;

    if (action.aggregationMode === 'latest_value') {
      return Math.max(...values);
    }
    if (action.aggregationMode === 'incremental_sum') {
      return values.reduce((sum, v) => sum + v, 0);
    }
    return 0; // 'none' mode — no meaningful daily total
  }

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

  // ─── Admin bypass link ────────────────────────────────────────────────────
  // Generates an HMAC-signed sig that lets an admin preview the portal without
  // the opening-screen gate, without affecting any other participant or the group.

  async getBypassLink(accessToken: string): Promise<{ sig: string }> {
    const pg = await this.prisma.participantGroup.findUnique({
      where: { accessToken },
      select: { id: true },
    });
    if (!pg) throw new NotFoundException('Access token not found');
    const secret = process.env.BYPASS_SECRET ?? 'challenge-bypass-dev-secret';
    const sig = createHmac('sha256', secret).update(accessToken).digest('hex').slice(0, 24);
    return { sig };
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

  /**
   * Full recompute of currentStreak, bestStreak, lastActionDate from ScoreEvent history.
   * Called after any deletion so stored values always reflect actual event data.
   */
  private async recomputeParticipantStreak(participantId: string, programId: string) {
    // Fetch all action ScoreEvents for this participant in this program, oldest first
    const scoreEvents = await this.prisma.scoreEvent.findMany({
      where: { participantId, programId, sourceType: 'action' },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    if (scoreEvents.length === 0) {
      await this.prisma.participantGameState.upsert({
        where: { participantId_programId: { participantId, programId } },
        create: { participantId, programId, currentStreak: 0, bestStreak: 0, lastActionDate: null },
        update: { currentStreak: 0, bestStreak: 0, lastActionDate: null },
      });
      return;
    }

    // Build a sorted set of unique calendar days (UTC midnight timestamps)
    const daySet = new Set<number>();
    for (const se of scoreEvents) {
      const d = new Date(se.createdAt);
      d.setHours(0, 0, 0, 0);
      daySet.add(d.getTime());
    }
    const days = Array.from(daySet).sort((a, b) => a - b);

    // Compute bestStreak across all history
    let best = 1;
    let run = 1;
    const DAY_MS = 86_400_000;
    for (let i = 1; i < days.length; i++) {
      if (days[i] - days[i - 1] === DAY_MS) {
        run++;
        if (run > best) best = run;
      } else {
        run = 1;
      }
    }

    // Compute currentStreak — consecutive days ending today or yesterday
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const yesterday = new Date(now.getTime() - DAY_MS);

    const lastDay = days[days.length - 1];
    let currentStreak = 0;

    // Streak is live only if the last action was today or yesterday
    if (lastDay === now.getTime() || lastDay === yesterday.getTime()) {
      currentStreak = 1;
      for (let i = days.length - 2; i >= 0; i--) {
        if (days[i + 1] - days[i] === DAY_MS) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    const lastActionDate = scoreEvents[scoreEvents.length - 1].createdAt;

    await this.prisma.participantGameState.upsert({
      where: { participantId_programId: { participantId, programId } },
      create: { participantId, programId, currentStreak, bestStreak: best, lastActionDate },
      update: { currentStreak, bestStreak: best, lastActionDate },
    });
  }

}
