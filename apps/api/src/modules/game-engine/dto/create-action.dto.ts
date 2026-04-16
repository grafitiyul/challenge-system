import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Min, ValidateIf, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { ActionContextUseDto } from './context-definition.dto';

export class ReorderItemDto {
  @IsString()
  id: string;

  @IsInt()
  @Min(0)
  sortOrder: number;
}

export class ReorderItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}

export class CreateActionDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  inputType?: string; // "boolean" | "number" | "select"

  @IsOptional()
  @IsString()
  aggregationMode?: string; // "none" | "latest_value" | "incremental_sum"

  @IsOptional()
  @IsString()
  unit?: string; // e.g. "steps", "floors", "minutes"

  @IsInt()
  @Min(0)
  points: number;

  /**
   * Phase 6.6 bundled-unit base scoring (optional). When BOTH unitSize AND
   * basePointsPerUnit are set — and the action is latest_value + number —
   * the base-point formula switches from flat-per-submission to
   * `delta_bundled_units * basePointsPerUnit`. Leave either null to keep
   * the existing flat-points behavior.
   */
  @IsOptional()
  @ValidateIf((o) => o.unitSize !== null)
  @IsInt()
  @Min(1)
  unitSize?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.basePointsPerUnit !== null)
  @IsInt()
  @Min(0)
  basePointsPerUnit?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.maxPerDay !== null)
  @IsInt()
  @Min(1)
  maxPerDay?: number | null;

  @IsOptional()
  @IsBoolean()
  showInPortal?: boolean;

  @IsOptional()
  @IsString()
  blockedMessage?: string | null;

  @IsOptional()
  @IsString()
  explanationContent?: string | null;

  @IsOptional()
  @IsString()
  soundKey?: string; // "none" | "ding" | "celebration" | "applause"

  /**
   * Phase 3.4: override the auto-derived participant-facing question
   * ("האם ביצעת פעולה זו?" / "כמה הגעת עד עכשיו?" / etc). Pass null to revert
   * to the auto default.
   */
  @IsOptional()
  @IsString()
  participantPrompt?: string | null;

  /**
   * Phase 4.1: optional free-text question shown under the main input during
   * submission (e.g. "מה היה הפיתוי?"). When null/empty the input is not
   * rendered. NOT used in analytics aggregation.
   */
  @IsOptional()
  @IsString()
  participantTextPrompt?: string | null;

  /** Phase 4.4: when true, submission is blocked on an empty text answer. */
  @IsOptional()
  @IsBoolean()
  participantTextRequired?: boolean;

  /**
   * Phase 3: local (action-only) context dimensions schema. Kept for backward
   * compat. Phase 3.2 prefers reusable definitions via `contextUses` below.
   */
  @IsOptional()
  @IsObject()
  contextSchemaJson?: Record<string, unknown> | null;

  /**
   * Phase 3.2: reusable context definitions attached to this action.
   * Order of the array becomes the presentation order.
   * Reconciliation is replace-all: definitions present here are attached;
   * those absent are detached.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActionContextUseDto)
  contextUses?: ActionContextUseDto[];
}

export class UpdateActionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  inputType?: string;

  @IsOptional()
  @IsString()
  aggregationMode?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  points?: number;

  /** See CreateActionDto.unitSize. Pass null to disable bundled-unit mode. */
  @IsOptional()
  @ValidateIf((o) => o.unitSize !== null)
  @IsInt()
  @Min(1)
  unitSize?: number | null;

  /** See CreateActionDto.basePointsPerUnit. Pass null to disable bundled-unit mode. */
  @IsOptional()
  @ValidateIf((o) => o.basePointsPerUnit !== null)
  @IsInt()
  @Min(0)
  basePointsPerUnit?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.maxPerDay !== null)
  @IsInt()
  @Min(1)
  maxPerDay?: number | null;

  @IsOptional()
  @IsBoolean()
  showInPortal?: boolean;

  @IsOptional()
  @IsString()
  blockedMessage?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  explanationContent?: string | null;

  @IsOptional()
  @IsString()
  soundKey?: string;

  /** See CreateActionDto.participantPrompt. Pass null to revert to the default. */
  @IsOptional()
  @IsString()
  participantPrompt?: string | null;

  /** See CreateActionDto.participantTextPrompt. Pass null/empty to remove. */
  @IsOptional()
  @IsString()
  participantTextPrompt?: string | null;

  /** See CreateActionDto.participantTextRequired. */
  @IsOptional()
  @IsBoolean()
  participantTextRequired?: boolean;

  /** See CreateActionDto.contextSchemaJson. Pass null to clear. */
  @IsOptional()
  @IsObject()
  contextSchemaJson?: Record<string, unknown> | null;

  /**
   * Phase 3.2: see CreateActionDto.contextUses. Omit to leave attachments
   * untouched; pass [] to detach everything.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActionContextUseDto)
  contextUses?: ActionContextUseDto[];
}
