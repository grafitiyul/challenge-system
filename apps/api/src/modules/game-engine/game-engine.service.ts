import { createHmac } from 'crypto';
import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateActionDto, UpdateActionDto } from './dto/create-action.dto';
import { CreateRuleDto, UpdateRuleDto } from './dto/create-rule.dto';
import { LogActionDto } from './dto/log-action.dto';
import { EvaluateRulesDto } from './dto/evaluate-rules.dto';
import { UnlockRuleDto } from './dto/unlock-rule.dto';
import { InitGroupStateDto } from './dto/init-group-state.dto';
import { CorrectLogDto, VoidLogDto } from './dto/correct-log.dto';
import { validateContext, validateContextSchemaShape } from './context-validation';

/** Narrow check for Postgres unique-violation errors surfaced by Prisma. */
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// ─── Phase 6.7: base scoring strategy layer ───────────────────────────────────
//
// Explicit discriminator: every action declares its scoring strategy. The
// engine dispatches on `baseScoringType` — there is no implicit activation
// by optional-field presence. Four strategies are supported:
//
//   flat                       — action.points per submission (flat).
//   quantity_multiplier        — action.points * submitted quantity.
//   latest_value_flat          — action.points per submission; monotonic.
//   latest_value_units_delta   — generic unit-progress scoring:
//                                deltaUnits * basePointsPerUnit
//
// The helpers below are the ONLY places base-point math lives. logAction and
// correctLog call them; nothing else should know the per-strategy formulas.

export type BaseScoringType =
  | 'flat'
  | 'quantity_multiplier'
  | 'latest_value_flat'
  | 'latest_value_units_delta';

const VALID_BASE_SCORING_TYPES: BaseScoringType[] = [
  'flat',
  'quantity_multiplier',
  'latest_value_flat',
  'latest_value_units_delta',
];

/**
 * Derive the effective aggregationMode from the declared scoring strategy.
 *   latest_value_flat / latest_value_units_delta → 'latest_value'
 *   quantity_multiplier                          → 'incremental_sum'
 *   flat                                         → 'none'
 * aggregationMode is kept as a separate persisted column (used by
 * getEffectiveDailyValue and the monotonic check) but admins no longer set
 * it directly — picking the strategy implies it.
 */
export function aggregationModeFor(
  scoringType: BaseScoringType,
): 'none' | 'latest_value' | 'incremental_sum' {
  switch (scoringType) {
    case 'latest_value_flat':
    case 'latest_value_units_delta':
      return 'latest_value';
    case 'quantity_multiplier':
      return 'incremental_sum';
    case 'flat':
    default:
      return 'none';
  }
}

/**
 * Reject invalid action configurations before they hit the DB. Each strategy
 * has a fixed set of required fields; mismatches throw BadRequestException so
 * the admin UI surfaces them.
 */
export function validateScoringConfig(dto: {
  baseScoringType: BaseScoringType;
  inputType: string;
  unitSize: number | null | undefined;
  basePointsPerUnit: number | null | undefined;
  maxPerDay: number | null | undefined;
}): void {
  const { baseScoringType: s, inputType, unitSize, basePointsPerUnit, maxPerDay } = dto;
  if (!VALID_BASE_SCORING_TYPES.includes(s)) {
    throw new BadRequestException(`שיטת ניקוד לא תקינה: ${s}`);
  }
  if (s === 'quantity_multiplier') {
    if (inputType !== 'number') {
      throw new BadRequestException('"נקודות לפי כמות" דורש קלט מספרי');
    }
  }
  if (s === 'latest_value_flat') {
    if (inputType !== 'number') {
      throw new BadRequestException('"נקודות קבועות לפי סה״כ שוטף" דורש קלט מספרי');
    }
  }
  if (s === 'latest_value_units_delta') {
    if (inputType !== 'number') {
      throw new BadRequestException('"נקודות לפי יחידות התקדמות" דורש קלט מספרי');
    }
    if (!unitSize || unitSize <= 0) {
      throw new BadRequestException('יש להגדיר גודל יחידה חיובי');
    }
    if (basePointsPerUnit === null || basePointsPerUnit === undefined || basePointsPerUnit < 0) {
      throw new BadRequestException('יש להגדיר נקודות ליחידה');
    }
    if (maxPerDay !== 1) {
      // Hard enforcement: this strategy's correction math is only exact when
      // there's a single active log per day. We'd rather block a confusing
      // configuration than silently produce drift-prone ledgers.
      throw new BadRequestException(
        'חישוב לפי יחידות התקדמות דורש מגבלה יומית של דיווח אחד',
      );
    }
  }
}

/**
 * Normalize scoring-related fields before persisting. Ensures that parameters
 * irrelevant to the selected strategy are cleared — e.g. a `flat` action will
 * never carry stray unitSize leftovers from an earlier edit.
 */
export function normalizeScoringFields(
  scoringType: BaseScoringType,
  unitSize: number | null | undefined,
  basePointsPerUnit: number | null | undefined,
): { unitSize: number | null; basePointsPerUnit: number | null } {
  if (scoringType === 'latest_value_units_delta') {
    return {
      unitSize: unitSize ?? null,
      basePointsPerUnit: basePointsPerUnit ?? null,
    };
  }
  return { unitSize: null, basePointsPerUnit: null };
}

type ActionScoringShape = {
  points: number;
  baseScoringType: string;
  unitSize: number | null;
  basePointsPerUnit: number | null;
};

/**
 * Compute base points for a NEW submission via the action's declared strategy.
 *   priorDailyMax — the participant's current `getEffectiveDailyValue` for
 *                   this action BEFORE this submission is applied. Used only
 *                   by latest_value_units_delta; safely passed as 0 for other
 *                   strategies.
 */
export function computeBasePointsForSubmission(
  action: ActionScoringShape,
  rawValue: string | null | undefined,
  priorDailyMax: number,
): number {
  const parsed = rawValue !== undefined && rawValue !== null ? parseFloat(rawValue) : NaN;
  switch (action.baseScoringType as BaseScoringType) {
    case 'flat':
    case 'latest_value_flat':
      return action.points;
    case 'quantity_multiplier':
      if (isNaN(parsed) || parsed <= 0) return 0;
      return Math.round(action.points * parsed);
    case 'latest_value_units_delta': {
      const unitSize = action.unitSize;
      const pointsPerUnit = action.basePointsPerUnit;
      if (!unitSize || unitSize <= 0 || pointsPerUnit === null || pointsPerUnit === undefined) {
        // Invariant broken (validation should have caught this at save time).
        // Zero is the safe answer — the ledger stays internally consistent.
        return 0;
      }
      const newUnits = isNaN(parsed) ? 0 : Math.floor(parsed / unitSize);
      const priorUnits = Math.floor(priorDailyMax / unitSize);
      return Math.max(0, (newUnits - priorUnits) * pointsPerUnit);
    }
    default:
      return 0;
  }
}

/**
 * Compute base points for a CORRECTION via the action's declared strategy.
 *   otherActiveMaxValue — max raw value of OTHER active logs today (the log
 *                         being corrected is excluded). For latest_value_units_delta
 *                         with maxPerDay=1 (enforced) this is always 0.
 *                         Kept as a parameter for completeness and future
 *                         relaxation.
 */
export function computeBasePointsForCorrection(
  action: ActionScoringShape,
  newRawValue: string,
  otherActiveMaxValue: number,
): number {
  const parsed = parseFloat(newRawValue);
  switch (action.baseScoringType as BaseScoringType) {
    case 'flat':
    case 'latest_value_flat':
      return action.points;
    case 'quantity_multiplier':
      if (isNaN(parsed) || parsed <= 0) return 0;
      return Math.round(action.points * parsed);
    case 'latest_value_units_delta': {
      const unitSize = action.unitSize;
      const pointsPerUnit = action.basePointsPerUnit;
      if (!unitSize || unitSize <= 0 || pointsPerUnit === null || pointsPerUnit === undefined) {
        return 0;
      }
      const newUnits = isNaN(parsed) ? 0 : Math.floor(parsed / unitSize);
      const otherUnits = Math.floor(otherActiveMaxValue / unitSize);
      // Can be negative (downward correction below another active log).
      // With maxPerDay=1 that path can't be reached; kept for symmetry.
      return (newUnits - otherUnits) * pointsPerUnit;
    }
    default:
      return 0;
  }
}

/**
 * Surface type used everywhere DB access can happen either against the bare client
 * or inside a `$transaction` callback. Prisma's `TransactionClient` is structurally
 * compatible with `PrismaClient`, so passing `this.prisma` as a `DbClient` is safe.
 */
type DbClient = Prisma.TransactionClient | PrismaService;

/**
 * Phase 3.2: resolve an action's effective context schema by merging:
 *   1. attached reusable ContextDefinitions (per-use override > default)
 *   2. the action's local contextSchemaJson dimensions (backward compat)
 *
 * De-dup by `key`: reusable attachments win over local dimensions with the
 * same key. Archived definitions are skipped (they drop out of the effective
 * schema for new submissions, but historical UserActionLog rows with values
 * under their key still resolve because data is keyed by string, not id).
 *
 * The result shape matches what validateContext()/parseSchema() expects.
 */
export async function resolveEffectiveContextSchema(
  db: DbClient,
  actionId: string,
): Promise<Record<string, unknown> | null> {
  const uses = await db.gameActionContextUse.findMany({
    where: { actionId },
    include: { definition: true },
    orderBy: { sortOrder: 'asc' },
  });
  const action = await db.gameAction.findUnique({
    where: { id: actionId },
    select: { contextSchemaJson: true },
  });

  const dims: Array<Record<string, unknown>> = [];
  const seenKeys = new Set<string>();

  // Layer A — reusable attachments first.
  for (const u of uses) {
    const d = u.definition;
    if (!d.isActive) continue;
    if (seenKeys.has(d.key)) continue;
    seenKeys.add(d.key);
    const required = u.requiredOverride ?? d.requiredByDefault;
    const visible = u.visibleToParticipantOverride ?? d.visibleToParticipantByDefault;
    const dim: Record<string, unknown> = {
      key: d.key,
      label: d.label,
      type: d.type,
      required,
      visibleToParticipant: visible,
      // Phase 3.3 behavior model — surfaced so logAction can inject fixed
      // values and stripHiddenDimensions can keep system dimensions out of
      // the participant UI. Defaults handle pre-3.3 rows (where the columns
      // carry the same "participant / visible / analytics-on" semantics).
      inputMode: d.inputMode ?? 'participant',
      analyticsVisible: d.analyticsVisible ?? true,
      ...(d.fixedValue !== null && d.fixedValue !== undefined
        ? { fixedValue: d.fixedValue }
        : {}),
    };
    if (d.type === 'select' && Array.isArray(d.optionsJson)) {
      dim.options = d.optionsJson;
    }
    dims.push(dim);
  }

  // Layer B — local dimensions (backward compat for pre-3.2 actions).
  const local = action?.contextSchemaJson as
    | { dimensions?: Array<Record<string, unknown>> }
    | null
    | undefined;
  if (local && Array.isArray(local.dimensions)) {
    for (const d of local.dimensions) {
      const k = typeof d.key === 'string' ? d.key : null;
      if (!k || seenKeys.has(k)) continue;
      seenKeys.add(k);
      dims.push(d);
    }
  }

  if (dims.length === 0) return null;
  return { dimensions: dims };
}

/** Deterministic per-day bucket key used for rule dedup (UTC). */
function dayBucketKey(d: Date): string {
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

/** Rule-evaluation result row. Kept exported-as-type so callers can consume it safely. */
export type RuleResult = {
  ruleId: string;
  fired: boolean;
  reason?: string;
  points?: number;
};

@Injectable()
export class GameEngineService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Actions CRUD ──────────────────────────────────────────────────────────

  listActions(programId: string) {
    // Phase 3.2: include attached reusable contexts + their definitions so the
    // admin action modal can render the "הקשרים משותפים" picker with current
    // state (including per-use overrides).
    return this.prisma.gameAction.findMany({
      where: { programId, isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        contextUses: {
          orderBy: { sortOrder: 'asc' },
          include: { definition: true },
        },
      },
    });
  }

  async createAction(programId: string, dto: CreateActionDto) {
    if (dto.contextSchemaJson !== undefined && dto.contextSchemaJson !== null) {
      validateContextSchemaShape(dto.contextSchemaJson);
    }
    const count = await this.prisma.gameAction.count({ where: { programId } });

    // Phase 6.7 scoring-strategy resolution. Admins pick `baseScoringType`;
    // aggregationMode is DERIVED (not admin-set), and unit parameters are
    // normalized so only the relevant strategy carries them.
    const inputType = dto.inputType ?? 'boolean';
    const baseScoringType = (dto.baseScoringType ?? 'flat') as BaseScoringType;
    validateScoringConfig({
      baseScoringType,
      inputType,
      unitSize: dto.unitSize ?? null,
      basePointsPerUnit: dto.basePointsPerUnit ?? null,
      maxPerDay: dto.maxPerDay ?? null,
    });
    const normalized = normalizeScoringFields(
      baseScoringType,
      dto.unitSize,
      dto.basePointsPerUnit,
    );

    // Phase 3.2: create the action + attach contextUses atomically so the
    // admin save is all-or-nothing even when the attachment list is non-empty.
    const action = await this.prisma.$transaction(async (tx) => {
      const created = await tx.gameAction.create({
        data: {
          programId,
          name: dto.name,
          description: dto.description ?? null,
          inputType,
          aggregationMode: aggregationModeFor(baseScoringType),
          unit: dto.unit ?? null,
          points: dto.points,
          baseScoringType,
          unitSize: normalized.unitSize,
          basePointsPerUnit: normalized.basePointsPerUnit,
          maxPerDay: dto.maxPerDay ?? null,
          showInPortal: dto.showInPortal ?? true,
          blockedMessage: dto.blockedMessage ?? null,
          explanationContent: dto.explanationContent ?? null,
          soundKey: dto.soundKey ?? 'none',
          participantPrompt: dto.participantPrompt ?? null,
          participantTextPrompt: dto.participantTextPrompt ?? null,
          participantTextRequired: dto.participantTextRequired ?? false,
          contextSchemaJson:
            (dto.contextSchemaJson ?? undefined) as Prisma.InputJsonValue | undefined,
          sortOrder: count,
        },
      });
      if (dto.contextUses && dto.contextUses.length > 0) {
        await this.applyContextUses(tx, created.id, programId, dto.contextUses);
      }
      return created;
    });

    return this.prisma.gameAction.findUnique({
      where: { id: action.id },
      include: {
        contextUses: {
          orderBy: { sortOrder: 'asc' },
          include: { definition: true },
        },
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

    // Phase 3: detect a context-schema change, validate the new shape, and
    // bump contextSchemaVersion so historical UserActionLog rows stay attributable
    // to the version that was in force at write time.
    let schemaPatch: {
      contextSchemaJson?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
      contextSchemaVersion?: number;
    } = {};
    if (dto.contextSchemaJson !== undefined) {
      if (dto.contextSchemaJson === null) {
        // Explicit clear.
        const wasNonEmpty = action.contextSchemaJson !== null;
        schemaPatch = {
          contextSchemaJson: Prisma.JsonNull,
          ...(wasNonEmpty ? { contextSchemaVersion: action.contextSchemaVersion + 1 } : {}),
        };
      } else {
        validateContextSchemaShape(dto.contextSchemaJson);
        const before = JSON.stringify(action.contextSchemaJson ?? null);
        const after = JSON.stringify(dto.contextSchemaJson);
        schemaPatch = {
          contextSchemaJson: dto.contextSchemaJson as Prisma.InputJsonValue,
          ...(before !== after ? { contextSchemaVersion: action.contextSchemaVersion + 1 } : {}),
        };
      }
    }

    // Phase 6.7: resolve the effective scoring config from the merge of
    // stored + incoming. Any change to baseScoringType, unitSize,
    // basePointsPerUnit, inputType, or maxPerDay re-validates the whole
    // set — we never let a partial edit produce a nonsensical combination.
    const nextInputType = dto.inputType ?? action.inputType;
    const nextBaseScoringType =
      (dto.baseScoringType ?? (action.baseScoringType as BaseScoringType)) as BaseScoringType;
    const nextUnitSize =
      dto.unitSize !== undefined ? dto.unitSize : action.unitSize;
    const nextBasePointsPerUnit =
      dto.basePointsPerUnit !== undefined ? dto.basePointsPerUnit : action.basePointsPerUnit;
    const nextMaxPerDay =
      dto.maxPerDay !== undefined ? dto.maxPerDay : action.maxPerDay;
    validateScoringConfig({
      baseScoringType: nextBaseScoringType,
      inputType: nextInputType,
      unitSize: nextUnitSize,
      basePointsPerUnit: nextBasePointsPerUnit,
      maxPerDay: nextMaxPerDay,
    });
    const normalized = normalizeScoringFields(
      nextBaseScoringType,
      nextUnitSize,
      nextBasePointsPerUnit,
    );
    const derivedAggregationMode = aggregationModeFor(nextBaseScoringType);

    // Phase 3.2: single transaction — action update + context-use reconciliation.
    // Omitting contextUses leaves attachments untouched; passing [] detaches all.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gameAction.update({
        where: { id: actionId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          inputType: nextInputType,
          // aggregationMode is ALWAYS derived from the scoring strategy —
          // admins no longer set it directly. Writing every time keeps it
          // in sync when the strategy changes.
          aggregationMode: derivedAggregationMode,
          baseScoringType: nextBaseScoringType,
          unitSize: normalized.unitSize,
          basePointsPerUnit: normalized.basePointsPerUnit,
          ...(dto.unit !== undefined ? { unit: dto.unit } : {}),
          ...(dto.points !== undefined ? { points: dto.points } : {}),
          ...(dto.maxPerDay !== undefined ? { maxPerDay: dto.maxPerDay } : {}),
          ...(dto.showInPortal !== undefined ? { showInPortal: dto.showInPortal } : {}),
          ...(dto.blockedMessage !== undefined ? { blockedMessage: dto.blockedMessage } : {}),
          ...(dto.explanationContent !== undefined ? { explanationContent: dto.explanationContent } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.soundKey !== undefined ? { soundKey: dto.soundKey } : {}),
          ...(dto.participantPrompt !== undefined ? { participantPrompt: dto.participantPrompt } : {}),
          ...(dto.participantTextPrompt !== undefined ? { participantTextPrompt: dto.participantTextPrompt } : {}),
          ...(dto.participantTextRequired !== undefined ? { participantTextRequired: dto.participantTextRequired } : {}),
          ...schemaPatch,
        },
      });

      if (dto.contextUses !== undefined) {
        await this.applyContextUses(tx, actionId, action.programId, dto.contextUses);
      }

      return tx.gameAction.findUnique({
        where: { id: updated.id },
        include: {
          contextUses: {
            orderBy: { sortOrder: 'asc' },
            include: { definition: true },
          },
        },
      });
    });
  }

  /**
   * Phase 3.2: replace-all reconciliation of a GameAction's attached reusable
   * contexts. `definitionId`s in `desired` are the new full attachment set; any
   * existing attachment not present in `desired` is detached.
   *
   * Guarantees:
   *   - Every `definitionId` must belong to the same program as the action.
   *   - Duplicates within `desired` are rejected.
   *   - Order in `desired` becomes the presentation order via `sortOrder`.
   */
  private async applyContextUses(
    tx: Prisma.TransactionClient,
    actionId: string,
    programId: string,
    desired: Array<{
      definitionId: string;
      requiredOverride?: boolean | null;
      visibleToParticipantOverride?: boolean | null;
    }>,
  ): Promise<void> {
    // Guard duplicates.
    const seen = new Set<string>();
    for (const d of desired) {
      if (seen.has(d.definitionId)) {
        throw new BadRequestException(
          `Duplicate context definition in attachments: ${d.definitionId}`,
        );
      }
      seen.add(d.definitionId);
    }

    // Sanity: every definition must live in this program.
    if (desired.length > 0) {
      const defs = await tx.contextDefinition.findMany({
        where: { id: { in: desired.map((d) => d.definitionId) } },
        select: { id: true, programId: true },
      });
      if (defs.length !== desired.length) {
        throw new NotFoundException('One or more context definitions not found');
      }
      for (const d of defs) {
        if (d.programId !== programId) {
          throw new BadRequestException(
            `Context definition ${d.id} does not belong to this program`,
          );
        }
      }
    }

    // Detach anything not in the desired set.
    const existing = await tx.gameActionContextUse.findMany({
      where: { actionId },
      select: { id: true, definitionId: true },
    });
    const desiredIds = new Set(desired.map((d) => d.definitionId));
    const toDelete = existing.filter((u) => !desiredIds.has(u.definitionId)).map((u) => u.id);
    if (toDelete.length > 0) {
      await tx.gameActionContextUse.deleteMany({ where: { id: { in: toDelete } } });
    }

    // Upsert each desired attachment. Using delete+create keeps the logic
    // trivial (unique on actionId+definitionId) without a separate diff pass
    // for overrides; since the write is inside the outer transaction the
    // momentary absence is never observable.
    if (desired.length > 0) {
      const existingByDef = new Map(
        existing.filter((u) => desiredIds.has(u.definitionId)).map((u) => [u.definitionId, u.id]),
      );
      const existingIdsStillKept = Array.from(existingByDef.values());
      if (existingIdsStillKept.length > 0) {
        await tx.gameActionContextUse.deleteMany({
          where: { id: { in: existingIdsStillKept } },
        });
      }
      await tx.gameActionContextUse.createMany({
        data: desired.map((d, idx) => ({
          actionId,
          definitionId: d.definitionId,
          requiredOverride: d.requiredOverride ?? null,
          visibleToParticipantOverride: d.visibleToParticipantOverride ?? null,
          sortOrder: idx,
        })),
      });
    }
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
  //
  // Contract (Phase 1 Foundation):
  //   - Idempotency: duplicate submissions with the same clientSubmissionId collapse
  //     to a single stored (log, scoreEvent) pair. Replayed calls return { replayed: true }.
  //   - Atomicity: UAL + ScoreEvent + (optional) FeedEvent are written inside a single
  //     SERIALIZABLE transaction. Partial failure leaves zero rows.
  //   - Ledger invariant: every action ScoreEvent has logId set (enforced by DB CHECK).
  //   - Chain: new logs set chainRootId = self.id (supersession inherits this root).
  //   - Context: contextJson is validated against action.contextSchemaJson before write.
  //   - Rules: the action's ScoreEvent id is passed to evaluateRules as triggeringEventId,
  //     so emitted rule events can set parentEventId + ScoreEventDependency.
  //
  async logAction(dto: LogActionDto) {
    const action = await this.prisma.gameAction.findUnique({ where: { id: dto.actionId } });
    if (!action) throw new NotFoundException(`Action ${dto.actionId} not found`);
    if (!action.isActive) throw new BadRequestException('Action is inactive');
    if (action.programId !== dto.programId) throw new BadRequestException('Action does not belong to this program');

    // ── Idempotency replay short-circuit ─────────────────────────────────────
    // If the same clientSubmissionId was already processed, return the prior result
    // rather than inserting a duplicate. A key collision across different
    // (participant, action) tuples is treated as client error.
    if (dto.clientSubmissionId) {
      const existing = await this.prisma.userActionLog.findUnique({
        where: { clientSubmissionId: dto.clientSubmissionId },
      });
      if (existing) {
        if (existing.participantId !== dto.participantId || existing.actionId !== dto.actionId) {
          throw new ConflictException(
            'Idempotency-Key already used for a different submission.',
          );
        }
        const scoreEvent = await this.prisma.scoreEvent.findFirst({
          where: { logId: existing.id, sourceType: 'action' },
        });
        return { log: existing, scoreEvent, ruleResults: [] as RuleResult[], replayed: true };
      }
    }

    // ── Context validation ───────────────────────────────────────────────────
    // Throws BadRequestException on invalid shape / required-field violations /
    // unknown keys / out-of-range numeric / bad select values.
    // Phase 3.2: validate against the EFFECTIVE schema (reusable + local merged)
    // so reusable-context submissions are accepted and required fields on
    // reusable contexts are enforced.
    const effectiveSchema = await resolveEffectiveContextSchema(this.prisma, action.id);

    // Phase 3.3: system_fixed injection.
    //   1. Identify dimensions with inputMode='system_fixed' (those are
    //      entirely owned by the backend — the participant never fills them).
    //   2. Reject any participant payload that tries to write those keys —
    //      this prevents client spoofing of system-managed dimensions.
    //   3. Inject each system dimension's `fixedValue` into the payload
    //      before it reaches validateContext, so the required-check passes
    //      and the value lands in UserActionLog.contextJson.
    const systemKeys = new Set<string>();
    const systemInjections: Record<string, unknown> = {};
    const dims = (effectiveSchema?.dimensions as Array<Record<string, unknown>> | undefined) ?? [];
    for (const d of dims) {
      if (d.inputMode === 'system_fixed' && typeof d.key === 'string') {
        systemKeys.add(d.key);
        if (typeof d.fixedValue === 'string' && d.fixedValue !== '') {
          systemInjections[d.key] = d.fixedValue;
        }
      }
    }
    if (dto.contextJson) {
      for (const key of Object.keys(dto.contextJson)) {
        if (systemKeys.has(key)) {
          throw new BadRequestException(
            `Context field "${key}" is system-managed and cannot be set by the client.`,
          );
        }
      }
    }
    const mergedContext =
      systemKeys.size === 0
        ? (dto.contextJson ?? null)
        : { ...systemInjections, ...(dto.contextJson ?? {}) };
    const validatedContext = validateContext(effectiveSchema, mergedContext);

    // Phase 4.4: required action-level text input blocks submission when
    // configured AND empty. Parallel to required-context validation; frontend
    // mirrors this check for immediate feedback.
    if (
      action.participantTextRequired &&
      action.participantTextPrompt &&
      action.participantTextPrompt.trim() &&
      !(dto.extraText && dto.extraText.trim())
    ) {
      throw new BadRequestException(
        `חובה למלא: ${action.participantTextPrompt.trim()}`,
      );
    }

    // ── maxPerDay — counts ACTIVE logs only ──────────────────────────────────
    if (action.maxPerDay !== null) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayCount = await this.prisma.userActionLog.count({
        where: {
          participantId: dto.participantId,
          actionId: dto.actionId,
          status: 'active',
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

    // ── latest_value monotonicity ────────────────────────────────────────────
    // "Running total" actions cannot decrease intra-day. Uses effective daily value
    // computed over active logs only (superseded ones do not anchor the floor).
    let effectiveValue: Prisma.Decimal | null = null;
    if (action.inputType === 'number' && action.aggregationMode === 'latest_value') {
      const parsed = parseFloat(dto.value ?? '');
      if (isNaN(parsed) || parsed < 0) {
        throw new BadRequestException('ערך מספרי חוקי נדרש עבור פעולה זו');
      }
      effectiveValue = new Prisma.Decimal(parsed);
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const currentEffective = await this.getEffectiveDailyValue(
        dto.participantId, dto.programId, dto.actionId, todayStart,
      );
      if (parsed < currentEffective) {
        throw new BadRequestException(
          `הערך ${parsed} נמוך מהסה"כ היומי הנוכחי (${currentEffective}). ` +
          `עבור פעולות "ערך שוטף", יש לדווח על הסה"כ הנוכחי — הערך לא יכול לרדת.`,
        );
      }
    } else if (action.inputType === 'number') {
      const parsed = parseFloat(dto.value ?? '');
      if (!isNaN(parsed)) effectiveValue = new Prisma.Decimal(parsed);
    }

    // ── Phase 6.7 base points via explicit strategy ──────────────────────────
    // Single dispatch: computeBasePointsForSubmission reads
    // action.baseScoringType and applies the matching formula. No hidden
    // activation, no fallbacks based on optional field presence. Threshold
    // rules (conditional type with ladder-delta anti-double-pay) continue
    // to read the raw effective daily value via getEffectiveDailyValue
    // below — unaffected by the scoring strategy.
    //
    // priorDailyMax is only consumed by the latest_value_units_delta
    // strategy; other strategies ignore it. Fetching it is skipped for
    // non-numeric actions (they can't need it).
    let priorDailyMax = 0;
    if (action.inputType === 'number') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      priorDailyMax = await this.getEffectiveDailyValue(
        dto.participantId,
        dto.programId,
        dto.actionId,
        todayStart,
      );
    }
    const pointsForThisLog = computeBasePointsForSubmission(
      action,
      dto.value,
      priorDailyMax,
    );

    // ── SERIALIZABLE transaction: UAL + ScoreEvent + FeedEvent + RULES ───────
    // Everything the submission produces — the action write AND all derived rule
    // events, dependencies, and feed rows — commits together or rolls back together.
    // Per-rule SAVEPOINTs inside evaluateRulesInTx keep one unique-violating rule
    // firing from aborting the whole submission; any other error bubbles up and
    // the outer transaction rolls back cleanly.
    try {
      const { log, scoreEvent, ruleResults } = await this.prisma.$transaction(
        async (tx) => {
          // 1. UAL — placeholder chainRootId then self-rewrite (Prisma doesn't
          //    expose the generated cuid ahead of insert).
          const created = await tx.userActionLog.create({
            data: {
              participantId: dto.participantId,
              programId: dto.programId,
              actionId: dto.actionId,
              value: dto.value ?? 'true',
              effectiveValue: effectiveValue ?? undefined,
              contextJson: (validatedContext ?? undefined) as Prisma.InputJsonValue | undefined,
              // Phase 4.1: action-level free-text, capped at 500 chars server-side.
              extraText: dto.extraText?.trim() ? dto.extraText.trim().slice(0, 500) : null,
              status: 'active',
              clientSubmissionId: dto.clientSubmissionId ?? null,
              schemaVersion: action.contextSchemaVersion,
              chainRootId: '__pending__',
            },
          });
          const updatedLog = await tx.userActionLog.update({
            where: { id: created.id },
            data: { chainRootId: created.id },
          });

          // 2. Action ScoreEvent.
          const se = await tx.scoreEvent.create({
            data: {
              participantId: dto.participantId,
              programId: dto.programId,
              groupId: dto.groupId ?? null,
              sourceType: 'action',
              sourceId: dto.actionId,
              points: pointsForThisLog,
              logId: updatedLog.id,
              metadata: { actionName: action.name, value: dto.value ?? 'true' },
            },
          });

          // 3. Action FeedEvent.
          if (dto.groupId) {
            const hasNumericValue = action.inputType === 'number' && dto.value && dto.value !== 'true';
            const valueStr = hasNumericValue
              ? `: ${dto.value}${action.unit ? ` ${action.unit}` : ''}`
              : '';
            // Phase 3.4: append the values of any text-type context dimensions
            // to the feed message so free-text participant notes surface in
            // מבזק without a UI change. Select / number dimensions already
            // show up in analytics; text is the one that otherwise vanishes.
            // Phase 4.4: the feed must always read naturally — select/number
            // contexts become "<dimension label>: <value label>" pairs, text
            // contexts stay as bare quoted strings, and the action-level
            // extra-text is quoted last. Internal value keys are NEVER shown.
            const feedParts: string[] = [];
            if (validatedContext) {
              const dims = (effectiveSchema?.dimensions as Array<Record<string, unknown>> | undefined) ?? [];
              for (const d of dims) {
                if (d.visibleToParticipant === false) continue;
                const k = d.key as string;
                const v = validatedContext[k];
                if (v === undefined || v === null || v === '') continue;
                const dimLabel = typeof d.label === 'string' ? d.label : k;
                if (d.type === 'text') {
                  if (typeof v === 'string' && v.trim()) {
                    feedParts.push(`"${v.trim()}"`);
                  }
                } else if (d.type === 'select') {
                  const opts = Array.isArray(d.options)
                    ? (d.options as Array<{ value?: string; label?: string }>)
                    : [];
                  const match = opts.find((o) => o.value === String(v));
                  const valueLabel = match?.label ?? String(v);
                  feedParts.push(`${dimLabel}: ${valueLabel}`);
                } else {
                  // number / any other scalar — render raw
                  feedParts.push(`${dimLabel}: ${String(v)}`);
                }
              }
            }
            if (dto.extraText && dto.extraText.trim()) {
              feedParts.push(`"${dto.extraText.trim().slice(0, 500)}"`);
            }
            const feedSuffix = feedParts.length ? ` · ${feedParts.join(' · ')}` : '';
            await tx.feedEvent.create({
              data: {
                participantId: dto.participantId,
                groupId: dto.groupId,
                programId: dto.programId,
                type: 'action',
                message: `דיווחה על ${action.name}${valueStr}${feedSuffix}`,
                points: pointsForThisLog,
                isPublic: true,
                logId: updatedLog.id,
                scoreEventId: se.id,
                // Legacy JSON payload — consumed by disabled deleteFeedEvent path.
                metadata: { logId: updatedLog.id, scoreEventId: se.id },
              },
            });
          }

          // 4. Rule evaluation — SAME transaction. Rule ScoreEvents, their
          //    dependency links, and their FeedEvents are all bound to the same
          //    atomic unit as the triggering action write. See evaluateRulesInTx.
          const ruleResults = await this.evaluateRulesInTx(tx, {
            participantId: dto.participantId,
            programId: dto.programId,
            groupId: dto.groupId,
            triggeringEventId: se.id,
          });

          return { log: updatedLog, scoreEvent: se, ruleResults };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { log, scoreEvent, ruleResults };
    } catch (e) {
      // Idempotency race — two concurrent requests with the same clientSubmissionId.
      // The second UAL insert collides on unique(clientSubmissionId) and the whole
      // transaction rolls back. Recover by returning the winner's stored result.
      if (isUniqueViolation(e) && dto.clientSubmissionId) {
        const existing = await this.prisma.userActionLog.findUnique({
          where: { clientSubmissionId: dto.clientSubmissionId },
        });
        if (existing) {
          const se = await this.prisma.scoreEvent.findFirst({
            where: { logId: existing.id, sourceType: 'action' },
          });
          return { log: existing, scoreEvent: se, ruleResults: [] as RuleResult[], replayed: true };
        }
      }
      throw e;
    }
  }

  // ─── Rule evaluation ───────────────────────────────────────────────────────

  // Public entrypoint — used by the admin "evaluate rules" endpoint. Opens its
  // own SERIALIZABLE transaction and delegates to evaluateRulesInTx.
  // When called from logAction, evaluateRulesInTx is called directly with the
  // outer transaction's client so the entire submission + rule evaluation is
  // atomic (see logAction).
  async evaluateRules(dto: EvaluateRulesDto): Promise<RuleResult[]> {
    return this.prisma.$transaction(
      async (tx) => this.evaluateRulesInTx(tx, dto),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * Rule evaluation bound to a caller-provided transaction client.
   *
   * Atomicity model:
   *   - All reads and writes run against `tx` — reads see the caller's uncommitted
   *     changes (e.g. the just-inserted action ScoreEvent), writes commit/rollback
   *     atomically with the caller.
   *   - Each rule firing is wrapped in a Postgres SAVEPOINT. If the firing's INSERT
   *     hits the partial unique index on (participantId, sourceId, bucketKey), we
   *     ROLLBACK TO that savepoint (not the outer transaction) and record the rule
   *     as `concurrent_firing_deduped`. Without a savepoint, a unique-violation
   *     would abort the outer transaction, erasing the submission itself.
   *   - Any non-unique error re-throws and poisons the outer transaction — that
   *     is intentional: unexpected errors must not silently lose state.
   */
  private async evaluateRulesInTx(
    tx: Prisma.TransactionClient,
    dto: EvaluateRulesDto,
  ): Promise<RuleResult[]> {
    const allRules = await tx.gameRule.findMany({
      where: { programId: dto.programId, isActive: true },
    });

    // Ladder stability: within one evaluation, fire lower thresholds before higher
    // ones so the ladder-delta read sees earlier commits.
    const rules = [...allRules].sort((a, b) => {
      if (a.type !== 'conditional' || b.type !== 'conditional') return 0;
      const ca = a.conditionJson as Record<string, unknown>;
      const cb = b.conditionJson as Record<string, unknown>;
      const ta = typeof ca['threshold'] === 'number' ? (ca['threshold'] as number) : null;
      const tb = typeof cb['threshold'] === 'number' ? (cb['threshold'] as number) : null;
      if (ta !== null && tb !== null && ca['actionId'] === cb['actionId']) return ta - tb;
      return 0;
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const groupDay = dto.groupId ? await this.getGroupDay(dto.groupId, tx) : null;
    const liveStreak = await this.getStreakLive(dto.participantId, dto.programId, tx);
    const bucketKey = dayBucketKey(new Date());
    const results: RuleResult[] = [];

    for (let idx = 0; idx < rules.length; idx++) {
      const rule = rules[idx];

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
        const unlock = await tx.groupRuleUnlock.findUnique({
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
      let pointsToAward = rewardPoints;

      if (rule.type === 'daily_bonus') {
        const alreadyGiven = await tx.scoreEvent.count({
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
        conditionMet = liveStreak.currentStreak >= minStreak;
        if (conditionMet) {
          const alreadyGiven = await tx.scoreEvent.count({
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
            const effectiveValue = await this.getEffectiveDailyValue(
              dto.participantId, dto.programId, requiredActionId, todayStart, tx,
            );
            conditionMet = effectiveValue >= threshold;
          } else {
            const logged = await tx.userActionLog.count({
              where: {
                participantId: dto.participantId,
                programId: dto.programId,
                actionId: requiredActionId,
                status: 'active',
                createdAt: { gte: todayStart },
              },
            });
            conditionMet = logged > 0;
          }

          if (conditionMet) {
            const alreadyFired = await tx.scoreEvent.count({
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

            const earned = await tx.scoreEvent.aggregate({
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

            if (delta <= 0) conditionMet = false;
            else             pointsToAward = delta;
          }
        }
      }

      if (!conditionMet) {
        results.push({ ruleId: rule.id, fired: false, reason: 'condition_not_met' });
        continue;
      }

      const dependencyEventIds = await this.collectRuleDependencies(
        rule, dto.participantId, dto.programId, todayStart, tx,
      );

      // ── Savepoint-wrapped rule firing ────────────────────────────────────
      // Savepoint name: simple ASCII identifier. Using the loop index is sufficient
      // and avoids any injection surface from rule ids (which are cuids anyway).
      const spName = `sp_rule_${idx}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${spName}`);
      try {
        const ruleEvent = await tx.scoreEvent.create({
          data: {
            participantId: dto.participantId,
            programId: dto.programId,
            groupId: dto.groupId ?? null,
            sourceType: 'rule',
            sourceId: rule.id,
            points: pointsToAward,
            parentEventId: dto.triggeringEventId ?? null,
            bucketKey,
            metadata: { ruleName: rule.name, ruleType: rule.type },
          },
        });

        if (dependencyEventIds.length > 0) {
          await tx.scoreEventDependency.createMany({
            data: dependencyEventIds.map((did) => ({
              eventId: ruleEvent.id,
              dependsOnEventId: did,
            })),
            skipDuplicates: true,
          });
        }

        if (dto.groupId && pointsToAward > 0) {
          await tx.feedEvent.create({
            data: {
              participantId: dto.participantId,
              groupId: dto.groupId,
              programId: dto.programId,
              type: 'rare',
              message: `קיבלה בונוס: ${rule.name}`,
              points: pointsToAward,
              isPublic: true,
              scoreEventId: ruleEvent.id,
              // Legacy JSON payload — kept only for historical FeedEvent consumers.
              metadata: { ruleId: rule.id },
            },
          });
        }

        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${spName}`);
        results.push({ ruleId: rule.id, fired: true, points: pointsToAward });
      } catch (e) {
        // Roll back only this rule's changes; outer transaction stays alive.
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${spName}`);
        if (isUniqueViolation(e)) {
          results.push({ ruleId: rule.id, fired: false, reason: 'concurrent_firing_deduped' });
          continue;
        }
        // Non-unique error: re-throw. Outer tx will rollback everything — correct,
        // because an unknown DB error means we cannot trust any subsequent writes.
        throw e;
      }
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

    // Streak is computed live from the ScoreEvent ledger — never read from
    // ParticipantGameState (which is write-deprecated as of Phase 1).
    const streak = await this.getStreakLive(participantId, programId);

    return {
      todayScore: todayRows._sum.points ?? 0,
      weekScore: weekRows._sum.points ?? 0,
      monthScore: monthRows._sum.points ?? 0,
      totalScore: totalRows._sum.points ?? 0,
      currentStreak: streak.currentStreak,
      bestStreak: streak.bestStreak,
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
      // Live per-participant streak — ParticipantGameState is no longer a read source.
      group.programId
        ? Promise.all(
            participantIds.map(async (pid) => {
              const s = await this.getStreakLive(pid, group.programId!);
              return { participantId: pid, currentStreak: s.currentStreak };
            }),
          )
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
    // Streak is computed live from ScoreEvents (programId scope) so it's always consistent with actual data.
    const [todayAgg, weekAgg, totalAgg, trendEvents, streak] = await Promise.all([
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, groupId, createdAt: { gte: todayStart } } }),
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, groupId, createdAt: { gte: weekStart } } }),
      this.prisma.scoreEvent.aggregate({ _sum: { points: true }, where: { participantId, groupId } }),
      this.prisma.scoreEvent.findMany({ where: { participantId, groupId, createdAt: { gte: since14 } }, select: { points: true, createdAt: true } }),
      this.getStreakLive(participantId, programId),
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
      currentStreak: streak.currentStreak,
      bestStreak: streak.bestStreak,
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

  // ─── Admin: delete feed event — DISABLED ─────────────────────────────────────
  //
  // The old implementation physically deleted ScoreEvent and UserActionLog rows,
  // which violates the Phase 1 immutable-ledger invariant. It is disabled here
  // with a 410 Gone so it cannot run — in any environment. Admins must use the
  // correction service (correctLog / voidLog) once the Phase 5 admin UI lands.
  //
  // Left un-removed (argument-accepting signature preserved) so Nest's existing
  // DELETE /admin/feed/:id endpoint fails loudly rather than 404'ing silently.

  async deleteFeedEvent(_feedEventId: string): Promise<never> {
    throw new GoneException(
      'Legacy hard-delete path disabled. Feed events can no longer be deleted; ' +
      'use the correction service (voidLog) to reverse the underlying submission.',
    );
  }

  // ─── Admin: bulk delete feed events — DISABLED ──────────────────────────────
  //
  // Same rationale as deleteFeedEvent: the old implementation physically deleted
  // ledger rows. Disabled with a 410 so legacy admin tools fail loudly instead
  // of silently corrupting totals.

  async bulkDeleteFeedEvents(_feedEventIds: string[]): Promise<never> {
    throw new GoneException(
      'Legacy bulk hard-delete path disabled. Feed events can no longer be deleted; ' +
      'use the correction service (voidLog, per submission) to reverse underlying entries.',
    );
  }

  // ─── Admin: reset participant progress — DISABLED ────────────────────────────
  //
  // The old implementation hard-deleted FeedEvents, ScoreEvents, and UserActionLogs
  // in bulk, which is the most dangerous of the three legacy paths (wipes history
  // wholesale). Disabled with 410. A future admin tool must compose voidLog calls
  // over the active chain heads if "reset this participant" is ever reintroduced.

  async resetParticipantProgress(
    _participantId: string,
    _groupId: string,
  ): Promise<never> {
    throw new GoneException(
      'Legacy participant-reset path disabled. This endpoint previously hard-deleted ' +
      'all ledger rows for a participant; a future admin UI must use voidLog over the ' +
      'participant\'s active submission chain heads to achieve the same effect safely.',
    );
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

  /**
   * Resolve the action ScoreEvents that a firing rule depends on. Rows returned here
   * become ScoreEventDependency links; future voiding of any dependency triggers
   * compensation of the rule event.
   *
   * Scope (Phase 1): today's action events for the relevant action(s).
   *   - daily_bonus: any action event today
   *   - conditional(actionId): action events today with that actionId
   *   - streak: today's action events (narrow; full-streak-tail cascade is Phase 5)
   */
  private async collectRuleDependencies(
    rule: { id: string; type: string; conditionJson: Prisma.JsonValue },
    participantId: string,
    programId: string,
    todayStart: Date,
    db: DbClient = this.prisma,
  ): Promise<string[]> {
    const condition = rule.conditionJson as Record<string, unknown>;
    const where: Prisma.ScoreEventWhereInput = {
      participantId,
      programId,
      sourceType: 'action',
      createdAt: { gte: todayStart },
    };
    if (rule.type === 'conditional' && typeof condition['actionId'] === 'string') {
      where.sourceId = condition['actionId'] as string;
    }
    const rows = await db.scoreEvent.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.id);
  }

  private async getEffectiveDailyValue(
    participantId: string,
    programId: string,
    actionId: string,
    todayStart: Date,
    db: DbClient = this.prisma,
  ): Promise<number> {
    const action = await db.gameAction.findUnique({ where: { id: actionId } });
    if (!action || action.inputType !== 'number') return 0;

    // Superseded/voided logs MUST be excluded — they no longer contribute to the
    // participant's effective total. Only active logs anchor the daily value.
    const logs = await db.userActionLog.findMany({
      where: {
        participantId,
        programId,
        actionId,
        status: 'active',
        createdAt: { gte: todayStart },
      },
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

  // revokeOrphanedRuleScoreEvents was removed with Phase 1 Task 2: it was the
  // rule-side cleanup for the legacy hard-delete paths. Those paths are disabled
  // (deleteFeedEvent / bulkDeleteFeedEvents / resetParticipantProgress now throw
  // 410). The rule cascade on correction is a Phase 5 concern — ScoreEventDependency
  // rows are written today and will be consumed by the future cascade.

  private async getGroupDay(
    groupId: string,
    db: DbClient = this.prisma,
  ): Promise<number | null> {
    // Inside a transaction we compute currentDay from startDate without triggering
    // getGroupState's side-effect update (that write does not belong inside the
    // submission transaction and would muddy rollback semantics).
    const state = await db.groupGameState.findUnique({ where: { groupId } });
    if (!state) return null;
    const diffMs = Date.now() - state.startDate.getTime();
    return Math.max(1, Math.floor(diffMs / 86_400_000) + 1);
  }

  /**
   * DEPRECATED — Phase 1 decision Q3: ParticipantGameState writes are stopped.
   * The method is retained as a no-op returning inert defaults so legacy callers
   * continue to compile. All streak reads route through getStreakLive() instead.
   *
   * Safe to delete once the ParticipantGameState table is dropped in a later phase.
   */
  private async getOrCreateParticipantState(_participantId: string, _programId: string) {
    return {
      id: '',
      participantId: _participantId,
      programId: _programId,
      currentStreak: 0,
      bestStreak: 0,
      lastActionDate: null,
      shieldsRemaining: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
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

  /**
   * DEPRECATED — Phase 1 Q3: no-op. Streak is derived live from ScoreEvents.
   * Retained so legacy deleteFeedEvent paths continue to compile without behavior change.
   */
  private async updateParticipantStreak(
    _participantId: string,
    _programId: string,
    _now: Date,
  ): Promise<void> {
    return;
  }

  /**
   * Compute currentStreak and bestStreak directly from ScoreEvent history without touching the DB.
   * Used by stats endpoints so streak is always derived from live data, never stale stored state.
   */
  async getStreakLive(
    participantId: string,
    programId: string,
    db: DbClient = this.prisma,
  ): Promise<{ currentStreak: number; bestStreak: number }> {
    const scoreEvents = await db.scoreEvent.findMany({
      where: { participantId, programId, sourceType: 'action' },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    if (scoreEvents.length === 0) return { currentStreak: 0, bestStreak: 0 };

    const DAY_MS = 86_400_000;
    const daySet = new Set<number>();
    for (const se of scoreEvents) {
      const d = new Date(se.createdAt);
      d.setHours(0, 0, 0, 0);
      daySet.add(d.getTime());
    }
    const days = Array.from(daySet).sort((a, b) => a - b);

    let best = 1, run = 1;
    for (let i = 1; i < days.length; i++) {
      if (days[i] - days[i - 1] === DAY_MS) { run++; if (run > best) best = run; }
      else run = 1;
    }

    const now = new Date(); now.setHours(0, 0, 0, 0);
    const yesterday = new Date(now.getTime() - DAY_MS);
    const lastDay = days[days.length - 1];
    let currentStreak = 0;
    if (lastDay === now.getTime() || lastDay === yesterday.getTime()) {
      currentStreak = 1;
      for (let i = days.length - 2; i >= 0; i--) {
        if (days[i + 1] - days[i] === DAY_MS) currentStreak++;
        else break;
      }
    }

    return { currentStreak, bestStreak: best };
  }

  /**
   * DEPRECATED — Phase 1 Q3: no-op. Readers use getStreakLive() instead.
   * Legacy deleteFeedEvent paths still call this; kept to preserve that behavior as a no-op.
   */
  private async recomputeParticipantStreak(
    _participantId: string,
    _programId: string,
  ): Promise<void> {
    return;
  }

  // ─── Corrections (Phase 1 Foundation) ───────────────────────────────────────
  //
  // Invariants:
  //   - Only the ACTIVE head of a supersession chain may be corrected or voided.
  //   - Every correction/voiding runs inside a single SERIALIZABLE transaction:
  //       supersede-old, insert-new (correctLog only), compensate-old-event,
  //       insert-new-event (correctLog only), hide-old-feed. Either all writes
  //       commit or none do.
  //   - supersedesId is UNIQUE → concurrent edits race; the loser gets 409.
  //   - chainRootId is inherited from the root so the chain stays discoverable.
  //   - The compensating ScoreEvent carries sourceType='correction' and
  //     parentEventId pointing to the event it reverses. Points are the negation
  //     of the original event's points. The correction event never has a logId.
  //   - Rule events that depended on the voided action event are NOT auto-cascaded
  //     in Phase 1 (full cascade is Phase 5). ScoreEventDependency rows are left
  //     in place so the cascade can be added later without data loss.
  //
  // These methods are intentionally service-layer only — no controller endpoints
  // are exposed in Phase 1 (decision Q8).

  /**
   * Apply a correction to an existing log. Produces a new active log that supersedes
   * the old one, plus a compensating ScoreEvent that reverses the old points and a
   * new ScoreEvent for the corrected points.
   *
   * Returns the NEW active log and the newly created action ScoreEvent.
   */
  async correctLog(dto: CorrectLogDto) {
    const oldLog = await this.prisma.userActionLog.findUnique({
      where: { id: dto.logId },
      include: { action: true },
    });
    if (!oldLog) throw new NotFoundException(`Log ${dto.logId} not found`);
    if (oldLog.status !== 'active') {
      throw new BadRequestException(
        `Log ${dto.logId} is not active (status=${oldLog.status}). ` +
        `Only the active head of a chain may be corrected.`,
      );
    }

    const newValue = dto.value ?? oldLog.value;
    // If contextJson is explicitly undefined, keep old. If provided (even as {}), replace.
    const nextContextRaw = dto.contextJson !== undefined ? dto.contextJson : oldLog.contextJson;
    const validatedContext = validateContext(oldLog.action.contextSchemaJson, nextContextRaw);

    // ── Phase 6.7 correction points via explicit strategy ──────────────────
    // Correction math dispatches on action.baseScoringType exactly like
    // submission math does. The compensation event (-oldPoints) is
    // unchanged; we only recompute the NEW log's points here.
    //
    // For latest_value_units_delta we need the max value of OTHER active
    // logs today — with maxPerDay=1 enforced at save time that's always 0,
    // but the lookup is kept for correctness if an admin relaxes maxPerDay
    // in a future non-strict variant.
    let effectiveValue: Prisma.Decimal | null = null;
    const parsedForEffective = parseFloat(newValue);
    if (oldLog.action.inputType === 'number' && !isNaN(parsedForEffective)) {
      effectiveValue = new Prisma.Decimal(parsedForEffective);
    }

    let otherActiveMaxValue = 0;
    if (oldLog.action.baseScoringType === 'latest_value_units_delta') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const otherActiveLogs = await this.prisma.userActionLog.findMany({
        where: {
          participantId: oldLog.participantId,
          programId: oldLog.programId,
          actionId: oldLog.actionId,
          status: 'active',
          createdAt: { gte: todayStart },
          id: { not: oldLog.id },
        },
        select: { value: true },
      });
      otherActiveMaxValue = otherActiveLogs
        .map((l) => parseFloat(l.value))
        .filter((v) => !isNaN(v) && v >= 0)
        .reduce((m, v) => Math.max(m, v), 0);
    }
    const newPoints = computeBasePointsForCorrection(
      oldLog.action,
      newValue,
      otherActiveMaxValue,
    );

    // Find the original action ScoreEvent for compensation.
    const oldScoreEvent = await this.prisma.scoreEvent.findFirst({
      where: { logId: oldLog.id, sourceType: 'action' },
    });
    if (!oldScoreEvent) {
      // Should be impossible given the CHECK constraint on action-type events.
      throw new BadRequestException(
        `Internal inconsistency: active log ${oldLog.id} has no action ScoreEvent.`,
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // 1. Mark old log superseded. supersedesId on the new log is the unique
          //    chain-anchor; its uniqueness closes the forked-correction race.
          await tx.userActionLog.update({
            where: { id: oldLog.id },
            data: { status: 'superseded', editedAt: new Date(), editedByRole: dto.actorRole },
          });

          // 2. Create the new active log, inheriting chainRootId.
          const newLog = await tx.userActionLog.create({
            data: {
              participantId: oldLog.participantId,
              programId: oldLog.programId,
              actionId: oldLog.actionId,
              value: newValue,
              effectiveValue: effectiveValue ?? undefined,
              contextJson: (validatedContext ?? undefined) as Prisma.InputJsonValue | undefined,
              status: 'active',
              supersedesId: oldLog.id,
              schemaVersion: oldLog.action.contextSchemaVersion,
              chainRootId: oldLog.chainRootId,
              editedByRole: dto.actorRole,
              editedAt: new Date(),
            },
          });

          // 3. Compensating ScoreEvent — reverses the old points.
          //    sourceType='correction', logId=NULL (CHECK only enforces non-null for 'action').
          const compensation = await tx.scoreEvent.create({
            data: {
              participantId: oldLog.participantId,
              programId: oldLog.programId,
              groupId: oldScoreEvent.groupId,
              sourceType: 'correction',
              sourceId: oldLog.actionId,
              points: -oldScoreEvent.points,
              parentEventId: oldScoreEvent.id,
              metadata: {
                reason: 'correction',
                supersededScoreEventId: oldScoreEvent.id,
                supersededLogId: oldLog.id,
                actorRole: dto.actorRole,
              },
            },
          });

          // 4. New ScoreEvent for the corrected value — linked to the new log,
          //    same CHECK-enforced invariant as a fresh submission.
          const newScoreEvent = await tx.scoreEvent.create({
            data: {
              participantId: oldLog.participantId,
              programId: oldLog.programId,
              groupId: oldScoreEvent.groupId,
              sourceType: 'action',
              sourceId: oldLog.actionId,
              points: newPoints,
              logId: newLog.id,
              metadata: {
                actionName: oldLog.action.name,
                value: newValue,
                correctedFromLogId: oldLog.id,
              },
            },
          });

          // 5. Hide the legacy FeedEvent for the old log (if any) by flipping isPublic.
          //    We don't delete — keeping the row preserves audit trail and
          //    backwards-compatibility with deleteFeedEvent (legacy path).
          await tx.feedEvent.updateMany({
            where: { logId: oldLog.id, type: 'action' },
            data: { isPublic: false },
          });

          return {
            oldLog,
            newLog,
            compensationScoreEvent: compensation,
            newScoreEvent,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        // Concurrent edit won — supersedesId collision.
        throw new ConflictException(
          `Log ${dto.logId} was corrected by another request. Reload and retry.`,
        );
      }
      throw e;
    }
  }

  /**
   * Void an active log (hard delete in UX terms, compensation in ledger terms).
   * Produces a superseded-with-no-successor state: the log is marked 'voided',
   * its points are compensated, and no new log is created.
   */
  async voidLog(dto: VoidLogDto) {
    const oldLog = await this.prisma.userActionLog.findUnique({
      where: { id: dto.logId },
    });
    if (!oldLog) throw new NotFoundException(`Log ${dto.logId} not found`);
    if (oldLog.status !== 'active') {
      throw new BadRequestException(
        `Log ${dto.logId} is not active (status=${oldLog.status}).`,
      );
    }

    const oldScoreEvent = await this.prisma.scoreEvent.findFirst({
      where: { logId: oldLog.id, sourceType: 'action' },
    });
    if (!oldScoreEvent) {
      throw new BadRequestException(
        `Internal inconsistency: active log ${oldLog.id} has no action ScoreEvent.`,
      );
    }

    return await this.prisma.$transaction(
      async (tx) => {
        await tx.userActionLog.update({
          where: { id: oldLog.id },
          data: { status: 'voided', editedAt: new Date(), editedByRole: dto.actorRole },
        });

        const compensation = await tx.scoreEvent.create({
          data: {
            participantId: oldLog.participantId,
            programId: oldLog.programId,
            groupId: oldScoreEvent.groupId,
            sourceType: 'correction',
            sourceId: oldLog.actionId,
            points: -oldScoreEvent.points,
            parentEventId: oldScoreEvent.id,
            metadata: {
              reason: 'void',
              supersededScoreEventId: oldScoreEvent.id,
              supersededLogId: oldLog.id,
              actorRole: dto.actorRole,
            },
          },
        });

        await tx.feedEvent.updateMany({
          where: { logId: oldLog.id, type: 'action' },
          data: { isPublic: false },
        });

        return { voidedLog: oldLog, compensationScoreEvent: compensation };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

}
