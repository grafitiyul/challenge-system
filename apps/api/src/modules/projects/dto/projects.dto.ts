import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Phase 1 item types — linked_task is Phase 2 and intentionally not listed.
export const PROJECT_ITEM_TYPES = ['boolean', 'number', 'select'] as const;
export type ProjectItemType = (typeof PROJECT_ITEM_TYPES)[number];

export const PROJECT_LOG_STATUSES = [
  'completed',
  'skipped_today',
  'committed',
  'value',
] as const;
export type ProjectLogStatus = (typeof PROJECT_LOG_STATUSES)[number];

// Phase 3 scheduling.
export const SCHEDULE_FREQUENCY_TYPES = ['none', 'daily', 'weekly'] as const;
export type ScheduleFrequencyType = (typeof SCHEDULE_FREQUENCY_TYPES)[number];

// ─── Project ────────────────────────────────────────────────────────────────

export class CreateProjectDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  colorHex?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  colorHex?: string;

  // Values: "active" | "archived" | "cancelled"
  @IsOptional()
  @IsIn(['active', 'archived', 'cancelled'])
  status?: 'active' | 'archived' | 'cancelled';
}

// ─── Items ──────────────────────────────────────────────────────────────────

export class SelectOptionDto {
  @IsString()
  value: string;

  @IsString()
  label: string;
}

export class CreateItemDto {
  @IsString()
  title: string;

  @IsIn(PROJECT_ITEM_TYPES as unknown as string[])
  itemType: ProjectItemType;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  targetValue?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectOptionDto)
  selectOptions?: SelectOptionDto[];

  // Phase 2: optional link to an existing PlanTask. Only valid when
  // itemType='boolean'; service-level validation rejects other combos.
  // Pass null to explicitly request "no link" (same semantic as omitting).
  @IsOptional()
  @IsString()
  linkedPlanTaskId?: string | null;

  // Phase 3 scheduling intent. Only valid when itemType='boolean'.
  //   frequencyType   "none" | "daily" | "weekly"
  //   timesPerWeek    required 1..7 when type='weekly'
  //   preferredWeekdays  CSV of 0..6, soft preference (optional)
  @IsOptional()
  @IsIn(SCHEDULE_FREQUENCY_TYPES as unknown as string[])
  scheduleFrequencyType?: ScheduleFrequencyType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  scheduleTimesPerWeek?: number | null;

  @IsOptional()
  @IsString()
  schedulePreferredWeekdays?: string | null;

  // Phase 4: optional end date ("YYYY-MM-DD"). null/undefined = indefinite.
  @IsOptional()
  @IsDateString()
  endDate?: string | null;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  targetValue?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectOptionDto)
  selectOptions?: SelectOptionDto[];

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  // Phase 2: pass a task id to link, null to unlink, omit to leave unchanged.
  // The string `''` is treated the same as null (unlink) to tolerate simple
  // frontend form serialization.
  @IsOptional()
  @IsString()
  linkedPlanTaskId?: string | null;

  // Phase 3 scheduling intent. Same semantics as on create. Omit to leave
  // unchanged; send 'none' to clear.
  @IsOptional()
  @IsIn(SCHEDULE_FREQUENCY_TYPES as unknown as string[])
  scheduleFrequencyType?: ScheduleFrequencyType;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  scheduleTimesPerWeek?: number | null;

  @IsOptional()
  @IsString()
  schedulePreferredWeekdays?: string | null;

  // Phase 4: update end date. Send null to clear, string to set.
  @IsOptional()
  @IsDateString()
  endDate?: string | null;
}

// Phase 3/4: "fill the week" endpoint body. Accepts a list of target dates
// plus a scope flag. When scope='recurring', the server also writes
// PlanTask.recurrenceWeekdays derived from the picked weekdays so future
// weeks auto-materialize via the existing materializer.
export const SCHEDULE_SCOPES = ['week', 'recurring'] as const;
export type ScheduleScope = (typeof SCHEDULE_SCOPES)[number];

export class ScheduleItemDto {
  // YYYY-MM-DD strings. Server-side validated for shape and recency.
  @IsArray()
  @IsDateString({}, { each: true })
  dates: string[];

  // Optional: when provided AND the item has no linkedPlanTaskId, server
  // creates a PlanTask with this title and links the goal to it before
  // creating the assignments. When the item is already linked, this field
  // is ignored.
  @IsOptional()
  @IsString()
  taskTitle?: string;

  // Phase 4 scope. Defaults to 'week' (non-destructive).
  //   'week'      → create assignments only for the picked dates
  //   'recurring' → additionally set PlanTask.recurrenceWeekdays to the
  //                 union of weekdays of the picked dates so future weeks
  //                 auto-materialize.
  @IsOptional()
  @IsIn(SCHEDULE_SCOPES as unknown as string[])
  scope?: ScheduleScope;
}

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

// ─── Logs ───────────────────────────────────────────────────────────────────

export class UpsertLogDto {
  @IsDateString()
  logDate: string; // YYYY-MM-DD in Asia/Jerusalem

  @IsIn(PROJECT_LOG_STATUSES as unknown as string[])
  status: ProjectLogStatus;

  @IsOptional()
  @IsNumber()
  numericValue?: number | null;

  @IsOptional()
  @IsString()
  selectValue?: string | null;

  @IsOptional()
  @IsString()
  skipNote?: string | null;

  @IsOptional()
  @IsString()
  commitNote?: string | null;
}

// ─── Notes ──────────────────────────────────────────────────────────────────

export class CreateNoteDto {
  @IsString()
  content: string;
}

// ─── Daily Context ──────────────────────────────────────────────────────────
//
// Participant-facing daily self-report panel. All fields optional on the
// wire — only supplied fields are written; omitted fields leave the prior
// value intact. No admin-side write surface in Phase 1.
export class UpsertDailyContextDto {
  @IsDateString()
  logDate: string; // YYYY-MM-DD in Asia/Jerusalem

  @IsOptional()
  @IsBoolean()
  hasPeriod?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  cravings?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  states?: string[];

  @IsOptional()
  @IsString()
  note?: string | null;
}
