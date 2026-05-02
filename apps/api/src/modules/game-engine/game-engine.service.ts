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

/**
 * Normalise an availability weekday list: int-only, in 0..6, deduped,
 * sorted. Keeps stored arrays canonical so equality / chip rendering
 * are stable across edits.
 */
function normaliseWeekdays(input: number[] | null | undefined): number[] {
  if (!input || !Array.isArray(input)) return [];
  const seen = new Set<number>();
  for (const n of input) {
    if (Number.isInteger(n) && n >= 0 && n <= 6) seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Normalise an availability YYYY-MM-DD list: regex-validated, deduped,
 * sorted lexicographically (which is also chronological for ISO YMD).
 */
function normaliseYmdList(input: string[] | null | undefined): string[] {
  if (!input || !Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const s of input) {
    if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) seen.add(s);
  }
  return Array.from(seen).sort();
}

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
    // Phase 6.9: multiple same-day submissions are now supported.
    // Chain recompute in correctLog/voidLog keeps the ledger exact across
    // intra-day corrections regardless of log count. No maxPerDay constraint.
    // Parameter `maxPerDay` is intentionally unused below.
    void maxPerDay;
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
/**
 * Per-action numeric input safety check. Generic — never references
 * specific action types (steps / water / etc.). Three independent
 * guards, each null-checked so a partially-configured action is still
 * partially protected:
 *
 *   maxDigits — counts NUMERIC digits in the parsed value's string
 *               form (no separators, no decimal point, no sign). The
 *               primary defense against the "extra digit" bug:
 *               a participant who meant 8000 and typed 80000 is
 *               immediately rejected even when no specific cap exists.
 *   maxValue  — inclusive upper bound on the parsed number.
 *   minValue  — inclusive lower bound on the parsed number.
 *
 * Throws BadRequestException with a Hebrew message when violated;
 * caller is logAction (server-side only — frontend mirrors this).
 * Never silently clamps — that would hide bad data instead of
 * surfacing it.
 */
export function validateNumericInputLimits(
  rawValue: string | null | undefined,
  limits: {
    maxDigits: number | null;
    maxValue: { toString(): string } | null;
    minValue: { toString(): string } | null;
  },
): void {
  // Skip if no limits configured — preserves the legacy behavior for
  // every action that hasn't opted in.
  if (limits.maxDigits === null && limits.maxValue === null && limits.minValue === null) {
    return;
  }
  const parsed = rawValue !== undefined && rawValue !== null ? parseFloat(rawValue) : NaN;
  if (isNaN(parsed)) {
    // No number to validate; the caller's separate parseFloat checks
    // will surface a clearer message. Don't throw here — keep this
    // helper single-purpose.
    return;
  }
  if (limits.minValue !== null) {
    const min = parseFloat(limits.minValue.toString());
    if (parsed < min) {
      throw new BadRequestException(
        `הערך שהוזן (${parsed}) נמוך מהמינימום המותר (${min}) לפעולה זו.`,
      );
    }
  }
  if (limits.maxValue !== null) {
    const max = parseFloat(limits.maxValue.toString());
    if (parsed > max) {
      throw new BadRequestException(
        `המספר שהוזן (${parsed}) גבוה מדי. בדקי שלא נוספה ספרה בטעות (מקסימום מותר: ${max}).`,
      );
    }
  }
  if (limits.maxDigits !== null) {
    // Count numeric digits only — strip every non-digit char, including
    // the decimal point, sign, and any thousands separators a future
    // input format might pass through. "8,000.5" → "80005" → 5 digits.
    const digitCount = String(rawValue).replace(/[^0-9]/g, '').length;
    if (digitCount > limits.maxDigits) {
      throw new BadRequestException(
        `המספר שהוזן (${parsed}) ארוך מדי — מותר עד ${limits.maxDigits} ספרות. בדקי שלא נוספה ספרה בטעות.`,
      );
    }
  }
}

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
 *
 * Phase 6.9 for `latest_value_units_delta`: this function now returns the
 * "pro-forma full" amount — `floor(value/unitSize) * pointsPerUnit` — as
 * if the corrected log were the first log of the day. The actual per-log
 * attribution is resolved immediately afterwards by `recomputeUnitsDeltaChain`
 * which walks the day's active logs chronologically and writes cascade
 * correction events that adjust every log's net points to match truth.
 *
 * Keeping this function pure (no chain lookup) makes the correction path
 * deterministic and the subsequent cascade step idempotent.
 */
export function computeBasePointsForCorrection(
  action: ActionScoringShape,
  newRawValue: string,
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
      // Pro-forma full amount; chain recompute will adjust this to the
      // correct marginal contribution based on the real chronological order.
      return Math.max(0, newUnits * pointsPerUnit);
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
          // Numeric safety limits — null when admin doesn't configure
          // them, preserving existing behavior. Decimal columns accept
          // a JS number directly; Prisma coerces to Decimal internally.
          maxDigits: dto.maxDigits ?? null,
          maxValue: dto.maxValue !== undefined && dto.maxValue !== null
            ? new Prisma.Decimal(dto.maxValue) : null,
          minValue: dto.minValue !== undefined && dto.minValue !== null
            ? new Prisma.Decimal(dto.minValue) : null,
          showInPortal: dto.showInPortal ?? true,
          blockedMessage: dto.blockedMessage ?? null,
          explanationContent: dto.explanationContent ?? null,
          soundKey: dto.soundKey ?? 'none',
          participantPrompt: dto.participantPrompt ?? null,
          participantTextPrompt: dto.participantTextPrompt ?? null,
          participantTextRequired: dto.participantTextRequired ?? false,
          contextSchemaJson:
            (dto.contextSchemaJson ?? undefined) as Prisma.InputJsonValue | undefined,
          // Availability schedule: dedup + sort on write so the stored
          // arrays are always canonical. Empty arrays preserve the
          // default "available every day" semantics.
          allowedWeekdays: normaliseWeekdays(dto.allowedWeekdays),
          extraAllowedDates: normaliseYmdList(dto.extraAllowedDates),
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
          // Numeric safety limits. Sending the field as null clears it
          // (back to "no restriction"); omitting the field leaves the
          // stored value untouched. Same partial-update pattern as the
          // rest of the service.
          ...(dto.maxDigits !== undefined ? { maxDigits: dto.maxDigits } : {}),
          ...(dto.maxValue !== undefined
            ? { maxValue: dto.maxValue !== null ? new Prisma.Decimal(dto.maxValue) : null }
            : {}),
          ...(dto.minValue !== undefined
            ? { minValue: dto.minValue !== null ? new Prisma.Decimal(dto.minValue) : null }
            : {}),
          ...(dto.showInPortal !== undefined ? { showInPortal: dto.showInPortal } : {}),
          ...(dto.blockedMessage !== undefined ? { blockedMessage: dto.blockedMessage } : {}),
          ...(dto.explanationContent !== undefined ? { explanationContent: dto.explanationContent } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.soundKey !== undefined ? { soundKey: dto.soundKey } : {}),
          ...(dto.participantPrompt !== undefined ? { participantPrompt: dto.participantPrompt } : {}),
          ...(dto.participantTextPrompt !== undefined ? { participantTextPrompt: dto.participantTextPrompt } : {}),
          ...(dto.participantTextRequired !== undefined ? { participantTextRequired: dto.participantTextRequired } : {}),
          // Availability schedule — only written when the admin sent a
          // value. Sending [] clears the rule (back to "every day" for
          // game actions). Omitting the field leaves storage untouched.
          ...(dto.allowedWeekdays !== undefined
            ? { allowedWeekdays: normaliseWeekdays(dto.allowedWeekdays) }
            : {}),
          ...(dto.extraAllowedDates !== undefined
            ? { extraAllowedDates: normaliseYmdList(dto.extraAllowedDates) }
            : {}),
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

    // ── latest_value monotonicity (FORWARD path only) ───────────────────────
    // "Running total" actions cannot decrease intra-day for NEW submissions.
    // Uses effective daily value computed over active logs only (superseded
    // ones do not anchor the floor).
    //
    // Phase 6.12: this restriction applies ONLY to the forward-submission
    // path (logAction). The correction path (correctLog) intentionally
    // OMITS this check — an admin or participant editing an existing log
    // must be able to correct its value downward. The chain recompute
    // (recomputeUnitsDeltaChain) + threshold recompute
    // (recomputeThresholdRulesForDay) guarantee the ledger stays exact
    // regardless of direction, so there's no safety reason to block it.
    // Removing this check from correctLog is a PRODUCT decision: truthful
    // corrections beat monotonic protection for historical logs.
    let effectiveValue: Prisma.Decimal | null = null;
    // Numeric input safety limits — generic per-action guards
    // (maxDigits / maxValue / minValue). Runs BEFORE any DB write so
    // a violation produces zero side effects: no UserActionLog, no
    // ScoreEvent, no FeedEvent. Same helper used by all four numeric
    // baseScoringType variants below; null limits short-circuit out.
    if (action.inputType === 'number') {
      validateNumericInputLimits(dto.value, {
        maxDigits: action.maxDigits,
        maxValue: action.maxValue,
        minValue: action.minValue,
      });
    }
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
          // creditedAt overrides createdAt for catch-up backdated reports.
          // occurredAt is left to its @default(now()) on every code path,
          // so it always reflects wall-clock submission time.
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
              ...(dto.creditedAt ? { createdAt: dto.creditedAt } : {}),
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
              ...(dto.creditedAt ? { createdAt: dto.creditedAt } : {}),
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
            // dto.messageSuffix carries the catch-up day-credit hint
            // (e.g. " (דווח עבור אתמול)"); empty for normal submissions.
            const catchUpSuffix = dto.messageSuffix ?? '';
            await tx.feedEvent.create({
              data: {
                participantId: dto.participantId,
                groupId: dto.groupId,
                programId: dto.programId,
                type: 'action',
                message: `דיווחה על ${action.name}${valueStr}${feedSuffix}${catchUpSuffix}`,
                points: pointsForThisLog,
                isPublic: true,
                logId: updatedLog.id,
                scoreEventId: se.id,
                // Legacy JSON payload — consumed by disabled deleteFeedEvent path.
                metadata: { logId: updatedLog.id, scoreEventId: se.id },
                ...(dto.creditedAt ? { createdAt: dto.creditedAt } : {}),
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

          // 5. Phase 6.10: reconcile threshold rules for THIS action on
          //    today. Forward-firing above already fires tiers crossed by
          //    this submission; recompute is a safety net that catches
          //    cases where forward firing is blocked (e.g. by alreadyFired
          //    guards after a prior correction). Idempotent: no writes
          //    when the ledger already matches the current effective value.
          await this.recomputeThresholdRulesForDay(tx, {
            participantId: dto.participantId,
            programId: dto.programId,
            actionId: dto.actionId,
            anchorDate: updatedLog.createdAt,
            reason: 'reconcile_after_submission',
            triggeredByLogId: updatedLog.id,
            groupIdHint: dto.groupId ?? null,
          });

          return { log: updatedLog, scoreEvent: se, ruleResults };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      // ── Scoring observability + duplicate-event guardrail ───────────────
      // Temporary log: prints the actionId, action name, raw value, base
      // points, rule firings, and the primary-group SE id so the operator
      // can diff "what the participant saw" against ledger truth.
      // The duplicate check is permanent — the participant-portal fan-out
      // is supposed to create exactly ONE action SE per (logId, groupId);
      // anything else is an invariant breach that would silently inflate
      // a per-group score.
      const actionSeForLog = await this.prisma.scoreEvent.findMany({
        where: { logId: log.id, sourceType: 'action' },
        select: { id: true, groupId: true, points: true },
      });
      const perGroup: Record<string, number> = {};
      for (const s of actionSeForLog) {
        const k = s.groupId ?? '<no-group>';
        perGroup[k] = (perGroup[k] ?? 0) + 1;
      }
      const dupGroups = Object.keys(perGroup).filter((k) => perGroup[k] > 1);
      // eslint-disable-next-line no-console
      console.log('[scoring-debug] log=%s action=%s(%s) value=%s base=%d ruleFired=%j actionSEs=%d primarySE=%s',
        log.id,
        action.name,
        action.baseScoringType,
        dto.value ?? '',
        pointsForThisLog,
        ruleResults.filter((r) => r.fired).map((r) => ({ ruleId: r.ruleId, points: r.points ?? 0 })),
        actionSeForLog.length,
        scoreEvent?.id ?? null,
      );
      if (dupGroups.length > 0) {
        // eslint-disable-next-line no-console
        console.error('[scoring-invariant-breach] duplicate action SE detected log=%s groups=%j  perGroup=%j',
          log.id, dupGroups, perGroup,
        );
      }

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

  // ─── (Legacy comment kept for context — superseded by Phase 6.15 below) ─
  //
  // The old implementation physically deleted ScoreEvent and UserActionLog rows,
  // which violates the Phase 1 immutable-ledger invariant. Between Phase 1 and
  // Phase 6.14 this endpoint threw 410 Gone so it could not run. Phase 6.15
  // replaces it with a ledger-safe implementation (see below) that uses
  // voidLog + correction events instead of hard-deletion.
  //
  // Left un-removed (argument-accepting signature preserved) so Nest's existing
  // DELETE /admin/feed/:id endpoint fails loudly rather than 404'ing silently.

  // ─── Admin: delete feed event — LEDGER-SAFE (Phase 6.15) ──────────────────
  //
  // Replaces the previous 410-Gone stub with a ledger-safe implementation.
  // Admin authority: NO same-day restriction, NO ownership check. An admin
  // can delete any feed entry at any time.
  //
  // Semantics by feed-event type:
  //   1. type='action' with an ACTIVE UserActionLog → delegate to voidLog.
  //      Full compensation (base points + prior cascade adjustments), units-
  //      delta chain recompute, threshold-rule recompute, feed auto-hidden.
  //   2. type='action' with a non-active log (already voided / superseded) →
  //      the ledger is already consistent. Just flip isPublic=false to hide.
  //   3. type='rare' / 'system' (rule bonuses etc.) → write a compensating
  //      ScoreEvent for the linked scoreEventId (if any) so the participant's
  //      total drops by the bonus amount, then hide the feed event.
  //
  // Row-level: never hard-delete. Always preserve history via isPublic + the
  // correction ledger. This is the Phase 1 immutable-ledger invariant.
  async deleteFeedEvent(feedEventId: string) {
    const event = await this.prisma.feedEvent.findUnique({
      where: { id: feedEventId },
      select: {
        id: true,
        type: true,
        logId: true,
        scoreEventId: true,
        participantId: true,
        programId: true,
        groupId: true,
        points: true,
        isPublic: true,
      },
    });
    if (!event) throw new NotFoundException(`Feed event ${feedEventId} not found`);
    if (!event.isPublic) {
      // Already hidden — idempotent no-op. Safe to call twice.
      return { feedEventId, outcome: 'already_hidden' as const };
    }

    // Case 1: action-type with its underlying log still active.
    if (event.type === 'action' && event.logId) {
      const log = await this.prisma.userActionLog.findUnique({
        where: { id: event.logId },
        select: { status: true },
      });
      if (log && log.status === 'active') {
        await this.voidLog({ logId: event.logId, actorRole: 'admin' });
        return { feedEventId, outcome: 'voided_log' as const, logId: event.logId };
      }
      // Log already superseded/voided — just hide the feed row.
      await this.prisma.feedEvent.update({
        where: { id: event.id },
        data: { isPublic: false },
      });
      return { feedEventId, outcome: 'hidden_stale_action' as const };
    }

    // Case 3: non-action feed event (rule bonus, system). Compensate the
    // linked scoreEvent if we know it, then hide the feed row.
    if (event.scoreEventId && event.points !== 0) {
      const scoreEvent = await this.prisma.scoreEvent.findUnique({
        where: { id: event.scoreEventId },
        select: { id: true, points: true, sourceType: true, sourceId: true },
      });
      if (scoreEvent) {
        await this.prisma.$transaction(async (tx) => {
          await tx.scoreEvent.create({
            data: {
              participantId: event.participantId,
              programId: event.programId,
              groupId: event.groupId,
              sourceType: 'correction',
              sourceId: scoreEvent.sourceId,
              points: -scoreEvent.points,
              parentEventId: scoreEvent.id,
              metadata: {
                reason: 'admin_feed_delete',
                feedEventId: event.id,
                supersededScoreEventId: scoreEvent.id,
                actorRole: 'admin',
              },
            },
          });
          await tx.feedEvent.update({
            where: { id: event.id },
            data: { isPublic: false },
          });
        });
        return { feedEventId, outcome: 'compensated_bonus' as const };
      }
    }

    // Fallback: no linked scoreEvent OR points=0 — just hide.
    await this.prisma.feedEvent.update({
      where: { id: event.id },
      data: { isPublic: false },
    });
    return { feedEventId, outcome: 'hidden_only' as const };
  }

  // ─── Admin: bulk delete feed events — LEDGER-SAFE (Phase 6.15) ──────────
  //
  // Runs deleteFeedEvent sequentially for each id so each item's transaction
  // commits cleanly and one failure doesn't abort the rest. Returns per-item
  // results so the admin UI can distinguish success from skip / error.
  async bulkDeleteFeedEvents(feedEventIds: string[]) {
    const results: Array<{
      feedEventId: string;
      ok: boolean;
      outcome?: string;
      error?: string;
    }> = [];
    for (const id of feedEventIds) {
      try {
        const r = await this.deleteFeedEvent(id);
        results.push({ feedEventId: id, ok: true, outcome: r.outcome });
      } catch (e) {
        const message =
          e instanceof Error ? e.message : typeof e === 'string' ? e : 'unknown';
        results.push({ feedEventId: id, ok: false, error: message });
      }
    }
    return { results };
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

  // ─── Phase 6.9: units-delta chain recompute ───────────────────────────────
  //
  // After any correction or void of a `latest_value_units_delta` log, walk
  // the day's active logs in chronological order and make each log's NET
  // points (action event + all correction adjustments) equal the value that
  // the current chain implies. Delta gets written as a single correction
  // scoreEvent per log-that-needs-adjustment. Idempotent: a second run with
  // no underlying change produces no writes.
  //
  // This is the ONLY place that tracks units-delta drift across intra-day
  // chains. The logAction and correctLog paths produce a reasonable initial
  // state; this function guarantees eventual correctness.
  //
  // Must be called INSIDE the same transaction as the originating change
  // so either both commit or both roll back.
  private async recomputeUnitsDeltaChain(
    tx: Prisma.TransactionClient,
    params: {
      participantId: string;
      programId: string;
      actionId: string;
      unitSize: number;
      pointsPerUnit: number;
      anchorDate: Date; // any time during the day whose chain to recompute
      reason: string;
      triggeredByLogId: string;
      actorRole?: string;
    },
  ): Promise<void> {
    const {
      participantId,
      programId,
      actionId,
      unitSize,
      pointsPerUnit,
      anchorDate,
      reason,
      triggeredByLogId,
      actorRole,
    } = params;
    if (unitSize <= 0) return;

    const dayStart = new Date(anchorDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // 1. Active logs for (participant, action) on that day, ordered by createdAt.
    const activeLogs = await tx.userActionLog.findMany({
      where: {
        participantId,
        programId,
        actionId,
        status: 'active',
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, value: true },
    });
    if (activeLogs.length === 0) return;

    const logIds = activeLogs.map((l) => l.id);

    // 2. Each log's action scoreEvent (1:1 by CHECK invariant).
    const actionEvents = await tx.scoreEvent.findMany({
      where: { logId: { in: logIds }, sourceType: 'action' },
      select: { id: true, logId: true, points: true, groupId: true },
    });
    const actionEventByLogId = new Map<
      string,
      { id: string; points: number; groupId: string | null }
    >();
    for (const e of actionEvents) {
      if (e.logId) actionEventByLogId.set(e.logId, e);
    }

    // 3. Every correction-type adjustment pointing at those action events.
    //    Summed per parent so we know each log's CURRENT net points.
    const actionEventIds = actionEvents.map((e) => e.id);
    const adjustments =
      actionEventIds.length > 0
        ? await tx.scoreEvent.findMany({
            where: {
              parentEventId: { in: actionEventIds },
              sourceType: 'correction',
            },
            select: { parentEventId: true, points: true },
          })
        : [];
    const adjustmentsByParent = new Map<string, number>();
    for (const a of adjustments) {
      if (!a.parentEventId) continue;
      adjustmentsByParent.set(
        a.parentEventId,
        (adjustmentsByParent.get(a.parentEventId) ?? 0) + a.points,
      );
    }

    // 4. Walk chronologically. priorMax tracks the largest value seen so far
    //    among logs preceding this one. Each log's expected points = the
    //    marginal units earned vs priorMax, multiplied by pointsPerUnit.
    let priorMax = 0;
    for (const log of activeLogs) {
      const raw = parseFloat(log.value);
      const valueSafe = isNaN(raw) || raw < 0 ? 0 : raw;
      const newUnits = Math.floor(valueSafe / unitSize);
      const priorUnits = Math.floor(priorMax / unitSize);
      const expected = Math.max(0, (newUnits - priorUnits) * pointsPerUnit);

      const actionEvent = actionEventByLogId.get(log.id);
      if (actionEvent) {
        const currentNet =
          actionEvent.points +
          (adjustmentsByParent.get(actionEvent.id) ?? 0);
        const delta = expected - currentNet;
        if (delta !== 0) {
          await tx.scoreEvent.create({
            data: {
              participantId,
              programId,
              groupId: actionEvent.groupId,
              sourceType: 'correction',
              sourceId: actionId,
              points: delta,
              parentEventId: actionEvent.id,
              metadata: {
                reason,
                cascadeForLogId: log.id,
                triggeredByLogId,
                previousEffectivePoints: currentNet,
                newEffectivePoints: expected,
                ...(actorRole ? { actorRole } : {}),
              },
            },
          });
        }
      }
      if (valueSafe > priorMax) priorMax = valueSafe;
    }
  }

  // ─── Phase 6.10: threshold-rule recompute ─────────────────────────────────
  //
  // After any change to same-day logs (new submission, correction, or void),
  // reconcile the per-rule net attribution with what the CURRENT effective
  // daily value implies. Uses the same ledger-preserving pattern as the
  // units-delta cascade: writes a single correction scoreEvent per rule
  // whose current net differs from expected.
  //
  // Ladder semantics (unchanged):
  //   Walk rules for this action sorted by threshold ASC. For each rule
  //   whose threshold <= effectiveValue, its expected per-rule contribution
  //   is `rule.rewardPoints - previousTierReward`. Rules that don't qualify
  //   get 0. Sum across rules = max qualifying rewardPoints (the admin's
  //   "tier" value). This matches the forward ladder-delta in evaluateRulesInTx.
  //
  // Idempotent: if the ledger is already consistent, no rows are written.
  // Must run INSIDE the caller's transaction.
  //
  // `groupIdHint` is used only when a brand-new correction needs to be
  // written for a rule that has no prior event today (e.g. upward correction
  // past a new threshold). Existing rule events carry their own groupId and
  // new cascade corrections inherit that.
  private async recomputeThresholdRulesForDay(
    tx: Prisma.TransactionClient,
    params: {
      participantId: string;
      programId: string;
      actionId: string;
      anchorDate: Date;
      reason: string;
      triggeredByLogId?: string;
      actorRole?: string;
      groupIdHint?: string | null;
    },
  ): Promise<void> {
    const { participantId, programId, actionId, anchorDate } = params;

    // 1. Load conditional + threshold rules for THIS action, ordered by tier.
    //    rewardPoints lives inside rewardJson.points — same shape the forward
    //    firing path reads in evaluateRulesInTx.
    const rulesRaw = await tx.gameRule.findMany({
      where: { programId, type: 'conditional', isActive: true },
      select: { id: true, conditionJson: true, rewardJson: true },
    });
    const rules = rulesRaw
      .map((r) => {
        const cond = r.conditionJson as Record<string, unknown>;
        if (typeof cond['actionId'] !== 'string' || cond['actionId'] !== actionId) return null;
        if (typeof cond['threshold'] !== 'number') return null;
        const reward = r.rewardJson as Record<string, unknown>;
        const rewardPoints =
          typeof reward?.['points'] === 'number' ? (reward['points'] as number) : 0;
        return {
          id: r.id,
          threshold: cond['threshold'] as number,
          rewardPoints,
        };
      })
      .filter((r): r is { id: string; threshold: number; rewardPoints: number } => r !== null)
      .sort((a, b) => a.threshold - b.threshold);
    if (rules.length === 0) return;

    // 2. Effective value for the day (uses existing helper, honors
    //    aggregationMode, reads only active logs).
    const dayStart = new Date(anchorDate);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const effectiveValue = await this.getEffectiveDailyValue(
      participantId,
      programId,
      actionId,
      dayStart,
      tx,
    );

    // 3. Expected per-rule using ladder semantics.
    const expectedByRule = new Map<string, number>();
    let prevReward = 0;
    for (const r of rules) {
      if (r.threshold <= effectiveValue) {
        expectedByRule.set(r.id, r.rewardPoints - prevReward);
        prevReward = r.rewardPoints;
      } else {
        expectedByRule.set(r.id, 0);
      }
    }

    // 4. Current net per rule = sum of EVERY event today tagged with that
    //    rule.id, across sourceType='rule' (forward firings) and 'correction'
    //    (prior recompute adjustments + manual compensations).
    const ruleIds = rules.map((r) => r.id);
    const events = await tx.scoreEvent.findMany({
      where: {
        participantId,
        programId,
        sourceId: { in: ruleIds },
        createdAt: { gte: dayStart, lt: dayEnd },
        OR: [
          { sourceType: 'rule' },
          { sourceType: 'correction' },
        ],
      },
      select: { sourceId: true, points: true, groupId: true },
    });
    const currentByRule = new Map<string, number>();
    const groupIdByRule = new Map<string, string | null>();
    for (const e of events) {
      if (!e.sourceId) continue;
      currentByRule.set(e.sourceId, (currentByRule.get(e.sourceId) ?? 0) + e.points);
      if (!groupIdByRule.has(e.sourceId)) groupIdByRule.set(e.sourceId, e.groupId);
    }

    // 5. Write one correction per mismatched rule.
    for (const r of rules) {
      const expected = expectedByRule.get(r.id) ?? 0;
      const current = currentByRule.get(r.id) ?? 0;
      const delta = expected - current;
      if (delta === 0) continue;
      const groupId =
        groupIdByRule.has(r.id)
          ? groupIdByRule.get(r.id) ?? null
          : params.groupIdHint ?? null;
      await tx.scoreEvent.create({
        data: {
          participantId,
          programId,
          groupId,
          sourceType: 'correction',
          sourceId: r.id,
          points: delta,
          metadata: {
            reason: params.reason,
            ruleRecomputeForRuleId: r.id,
            thresholdAtTime: r.threshold,
            effectiveValueAtTime: effectiveValue,
            previousEffectivePoints: current,
            newEffectivePoints: expected,
            ...(params.triggeredByLogId ? { triggeredByLogId: params.triggeredByLogId } : {}),
            ...(params.actorRole ? { actorRole: params.actorRole } : {}),
          },
        },
      });
    }
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
    // Phase 3: accept either participant-scoped or legacy per-group tokens.
    const direct = await this.prisma.participant.findUnique({
      where: { accessToken },
      select: { id: true },
    });
    if (!direct) {
      const pg = await this.prisma.participantGroup.findUnique({
        where: { accessToken },
        select: { id: true },
      });
      if (!pg) throw new NotFoundException('Access token not found');
    }
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
    // Phase 6.12 contract: corrections accept values LOWER than the day's
    // current effective max. This is intentional and distinct from the
    // forward-submission path (logAction) which enforces monotonicity.
    // Downward corrections are how participants/admins fix mistakes and
    // are fully supported by the subsequent chain + threshold recompute.
    // Do NOT add a monotonic check here.
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
    // Phase 6.13: only RE-VALIDATE context when the caller explicitly
    // supplied a new payload. If `dto.contextJson === undefined` the caller
    // is saying "leave context alone" — preserve whatever is stored on the
    // existing log byte-for-byte and skip validation.
    //
    // This fix unblocks two paths that used to fail spuriously:
    //   1. Participant self-edit (value-only edit). The caller never sends
    //      contextJson; previously we'd revalidate oldLog.contextJson, which
    //      is populated from the EFFECTIVE schema (local + reusable context
    //      definitions), against `action.contextSchemaJson` alone (only the
    //      LOCAL schema). Logs that carried reusable-context values got
    //      rejected with "Action does not accept context fields".
    //   2. Admin correction flows where the action's context schema changed
    //      since the log was written. Re-validating stale context against
    //      the current schema punished the admin for an orthogonal change.
    //
    // When the caller DOES supply a new contextJson, validate it normally —
    // the payload is a participant/admin statement of intent that must be
    // enforced against current rules.
    let validatedContext: Record<string, unknown> | null;
    if (dto.contextJson !== undefined) {
      validatedContext = validateContext(
        oldLog.action.contextSchemaJson,
        dto.contextJson,
      );
    } else {
      validatedContext = oldLog.contextJson as Record<string, unknown> | null;
    }

    // ── Phase 6.9 correction points ────────────────────────────────────────
    // For units_delta: compute pro-forma full points; the cascade step
    // inside the transaction below adjusts per-log attribution to reflect
    // the real chronological chain (including logs downstream of the one
    // being corrected).
    // For every other strategy: unchanged — strategy helper returns the
    // stable per-log amount.
    let effectiveValue: Prisma.Decimal | null = null;
    const parsedForEffective = parseFloat(newValue);
    if (oldLog.action.inputType === 'number' && !isNaN(parsedForEffective)) {
      effectiveValue = new Prisma.Decimal(parsedForEffective);
    }
    const newPoints = computeBasePointsForCorrection(oldLog.action, newValue);
    const isUnitsDelta =
      oldLog.action.baseScoringType === 'latest_value_units_delta';

    // Phase 8 multi-group fan-out — a single submission can have N
    // action ScoreEvents (one per group the participant chose, all
    // sharing logId). Edit must compensate every old event AND emit a
    // new event per group the original report covered, so each group's
    // ledger reflects the corrected points. Mirrors voidLog's per-event
    // loop. Single-group submissions hit the same code path with a
    // 1-element array — no behaviour change for them.
    const oldScoreEvents = await this.prisma.scoreEvent.findMany({
      where: { logId: oldLog.id, sourceType: 'action' },
      orderBy: { createdAt: 'asc' },
    });
    if (oldScoreEvents.length === 0) {
      // Should be impossible given the CHECK constraint on action-type events.
      throw new BadRequestException(
        `Internal inconsistency: active log ${oldLog.id} has no action ScoreEvent.`,
      );
    }
    // The first action event remains the "primary" — used for cascade
    // hints (units-delta + threshold rules) so those engines don't
    // need to fork yet. The new fan-out below covers every group.
    const oldScoreEvent = oldScoreEvents[0];

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
          //
          // Phase 6.9: for units_delta actions ALSO inherit the old log's
          // createdAt. Same-day chain-recompute is keyed by createdAt, so
          // a correction must occupy the exact timeline slot of the log
          // it replaced — otherwise downstream logs would see the wrong
          // priorMax. editedAt captures the actual correction time for
          // audit; createdAt captures the "submission time".
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
              ...(isUnitsDelta ? { createdAt: oldLog.createdAt } : {}),
            },
          });

          // 3. Compensate every per-group old action event AND emit a
          //    matching new action event for the corrected value. Each
          //    pair stays bound to one group so the per-group ledger
          //    walks cleanly:
          //      Group G:  old (+oldPts), correction (-net), new (+newPts)
          //    sourceType filter excludes rule events (those carry
          //    parentEventId=action.id but are reconciled by the
          //    threshold-rule pass below).
          const compensations = [];
          const newScoreEvents = [];
          for (const ev of oldScoreEvents) {
            const priorAdjustments = await tx.scoreEvent.findMany({
              where: { parentEventId: ev.id, sourceType: 'correction' },
              select: { points: true },
            });
            const priorAdjustmentsSum = priorAdjustments.reduce((s, a) => s + a.points, 0);
            const netPoints = ev.points + priorAdjustmentsSum;
            const c = await tx.scoreEvent.create({
              data: {
                participantId: oldLog.participantId,
                programId: oldLog.programId,
                groupId: ev.groupId,
                sourceType: 'correction',
                sourceId: oldLog.actionId,
                points: -netPoints,
                parentEventId: ev.id,
                metadata: {
                  reason: 'correction',
                  supersededScoreEventId: ev.id,
                  supersededLogId: oldLog.id,
                  supersededLogNetPoints: netPoints,
                  actorRole: dto.actorRole,
                },
              },
            });
            compensations.push(c);

            const ns = await tx.scoreEvent.create({
              data: {
                participantId: oldLog.participantId,
                programId: oldLog.programId,
                groupId: ev.groupId,
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
            newScoreEvents.push(ns);
          }
          // Keep the legacy single return shape — first compensation +
          // first new event, matching the previous contract.
          const compensation = compensations[0];
          const newScoreEvent = newScoreEvents[0];

          // 5. Hide the legacy FeedEvent for the old log (if any) by flipping isPublic.
          //    We don't delete — keeping the row preserves audit trail and
          //    backwards-compatibility with deleteFeedEvent (legacy path).
          await tx.feedEvent.updateMany({
            where: { logId: oldLog.id, type: 'action' },
            data: { isPublic: false },
          });

          // 6. Phase 6.9: for units_delta, recompute the whole day's chain
          //    so every log (including downstream siblings) ends up with the
          //    correct net attribution. Writes cascade correction events
          //    only where the net currently differs from expected.
          if (
            isUnitsDelta &&
            oldLog.action.unitSize &&
            oldLog.action.unitSize > 0 &&
            oldLog.action.basePointsPerUnit !== null
          ) {
            await this.recomputeUnitsDeltaChain(tx, {
              participantId: oldLog.participantId,
              programId: oldLog.programId,
              actionId: oldLog.actionId,
              unitSize: oldLog.action.unitSize,
              pointsPerUnit: oldLog.action.basePointsPerUnit,
              anchorDate: oldLog.createdAt,
              reason: 'cascade_after_correction',
              triggeredByLogId: oldLog.id,
              actorRole: dto.actorRole,
            });
          }

          // 7. Phase 6.10: reconcile threshold-rule bonuses for this action
          //    on this day. Runs for EVERY scoring type — threshold rules
          //    only fire for actions with such rules attached, and the
          //    function short-circuits when none exist. After this call the
          //    ledger's per-rule net matches the current effective daily
          //    value exactly.
          await this.recomputeThresholdRulesForDay(tx, {
            participantId: oldLog.participantId,
            programId: oldLog.programId,
            actionId: oldLog.actionId,
            anchorDate: oldLog.createdAt,
            reason: 'cascade_after_correction',
            triggeredByLogId: oldLog.id,
            actorRole: dto.actorRole,
            groupIdHint: oldScoreEvent.groupId,
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
      include: { action: true },
    });
    if (!oldLog) throw new NotFoundException(`Log ${dto.logId} not found`);
    if (oldLog.status !== 'active') {
      throw new BadRequestException(
        `Log ${dto.logId} is not active (status=${oldLog.status}).`,
      );
    }

    // Phase 8 multi-group fan-out — a single submission can produce
    // multiple `action` ScoreEvents (one per group the participant
    // selected, all sharing this logId). Void must compensate every
    // one of them, not just the first; otherwise other groups' totals
    // keep the points after a delete. Single-group submissions hit
    // this same code path with a 1-element array — no behavior change
    // for them.
    const oldScoreEvents = await this.prisma.scoreEvent.findMany({
      where: { logId: oldLog.id, sourceType: 'action' },
      orderBy: { createdAt: 'asc' },
    });
    if (oldScoreEvents.length === 0) {
      throw new BadRequestException(
        `Internal inconsistency: active log ${oldLog.id} has no action ScoreEvent.`,
      );
    }
    // The first action event remains the "primary" — used downstream
    // for cascade hints (units-delta + threshold rules) so that side
    // doesn't fork yet. Rule firings still attach to the primary.
    const oldScoreEvent = oldScoreEvents[0];

    return await this.prisma.$transaction(
      async (tx) => {
        await tx.userActionLog.update({
          where: { id: oldLog.id },
          data: { status: 'voided', editedAt: new Date(), editedByRole: dto.actorRole },
        });

        // Compensate every per-group action event linked to this log.
        // Each compensation is parented to its own action event so a
        // future per-group correction cascade still has a clean chain
        // to walk. priorAdjustments are also computed per event so the
        // net is correct group-by-group.
        const compensations = [];
        for (const ev of oldScoreEvents) {
          const priorAdjustments = await tx.scoreEvent.findMany({
            where: { parentEventId: ev.id, sourceType: 'correction' },
            select: { points: true },
          });
          const priorAdjustmentsSum = priorAdjustments.reduce((s, a) => s + a.points, 0);
          const netPoints = ev.points + priorAdjustmentsSum;
          const c = await tx.scoreEvent.create({
            data: {
              participantId: oldLog.participantId,
              programId: oldLog.programId,
              groupId: ev.groupId,
              sourceType: 'correction',
              sourceId: oldLog.actionId,
              points: -netPoints,
              parentEventId: ev.id,
              metadata: {
                reason: 'void',
                supersededScoreEventId: ev.id,
                supersededLogId: oldLog.id,
                supersededLogNetPoints: netPoints,
                actorRole: dto.actorRole,
              },
            },
          });
          compensations.push(c);
        }
        // Keep the legacy single return shape — first compensation is
        // the "primary" one, matching the old contract.
        const compensation = compensations[0];

        // Hide the social-feed entry from every group at once. updateMany
        // already keys on logId, so all fanned-out feed rows go private
        // in a single statement — no per-group loop needed.
        await tx.feedEvent.updateMany({
          where: { logId: oldLog.id, type: 'action' },
          data: { isPublic: false },
        });

        // Phase 6.9: recompute the day's chain when voiding a units_delta
        // log. Downstream logs' priorMax shifts once this log is no longer
        // active; cascade writes correction events to correct their net.
        if (
          oldLog.action.baseScoringType === 'latest_value_units_delta' &&
          oldLog.action.unitSize &&
          oldLog.action.unitSize > 0 &&
          oldLog.action.basePointsPerUnit !== null
        ) {
          await this.recomputeUnitsDeltaChain(tx, {
            participantId: oldLog.participantId,
            programId: oldLog.programId,
            actionId: oldLog.actionId,
            unitSize: oldLog.action.unitSize,
            pointsPerUnit: oldLog.action.basePointsPerUnit,
            anchorDate: oldLog.createdAt,
            reason: 'cascade_after_void',
            triggeredByLogId: oldLog.id,
            actorRole: dto.actorRole,
          });
        }

        // Phase 6.10: reconcile threshold rules. Voiding a log can drop the
        // effective daily value below a previously-satisfied tier; recompute
        // writes negative corrections to remove bonuses that no longer apply.
        await this.recomputeThresholdRulesForDay(tx, {
          participantId: oldLog.participantId,
          programId: oldLog.programId,
          actionId: oldLog.actionId,
          anchorDate: oldLog.createdAt,
          reason: 'cascade_after_void',
          triggeredByLogId: oldLog.id,
          actorRole: dto.actorRole,
          groupIdHint: oldScoreEvent.groupId,
        });

        return { voidedLog: oldLog, compensationScoreEvent: compensation };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

}
