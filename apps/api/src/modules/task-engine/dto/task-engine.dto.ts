import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Plan ─────────────────────────────────────────────────────────────────────

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  status?: string;
}

// ─── Goals ────────────────────────────────────────────────────────────────────

export class CreateGoalDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isAbandoned?: boolean;
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export class CreateTaskDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  goalId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedMinutes?: number;

  /**
   * Phase 6.16 recurrence — CSV of weekday indices, e.g. "0,2,4" for Sun/Tue/Thu.
   * Null/empty string means "not recurring". Valid values per digit: 0..6 where
   * 0=Sunday ... 6=Saturday. Server-side validation in the service.
   */
  @IsOptional()
  @IsString()
  recurrenceWeekdays?: string | null;

  @IsOptional()
  @IsString()
  recurrenceStartTime?: string | null;

  @IsOptional()
  @IsString()
  recurrenceEndTime?: string | null;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isAbandoned?: boolean;

  @IsOptional()
  @IsString()
  goalId?: string;

  /** See CreateTaskDto.recurrenceWeekdays. Pass null/empty string to stop recurrence. */
  @IsOptional()
  @IsString()
  recurrenceWeekdays?: string | null;

  @IsOptional()
  @IsString()
  recurrenceStartTime?: string | null;

  @IsOptional()
  @IsString()
  recurrenceEndTime?: string | null;
}

// Phase 6.16: task duplication body. If omitted, server uses sensible defaults
// (copy into the same plan, keep the original goalId, do not auto-assign).
export class DuplicateTaskDto {
  /** Override the title; if omitted, server appends "(עותק)" to the original. */
  @IsOptional()
  @IsString()
  title?: string;

  /** Optional: copy into a different plan (default: same plan as source). */
  @IsOptional()
  @IsString()
  planId?: string;

  /** Optional: override the goal attachment (default: same goal as source). */
  @IsOptional()
  @IsString()
  goalId?: string | null;

  /**
   * Optional: create an assignment for this YYYY-MM-DD after duplication.
   * When the source had a scheduledDate, the UI typically defaults this to
   * the next occurrence of the same weekday. Server does not auto-roll.
   */
  @IsOptional()
  @IsString()
  assignToDate?: string;
}

// Phase 6.16: goal duplication body. Optional target plan so participant can
// copy a goal forward into next week.
export class DuplicateGoalDto {
  @IsOptional()
  @IsString()
  title?: string;

  /** Copy into a different plan; default: same plan. */
  @IsOptional()
  @IsString()
  planId?: string;

  /** When true, also duplicate the goal's tasks (title/notes only, no assignments). Default false. */
  @IsOptional()
  @IsBoolean()
  includeTasks?: boolean;
}

// ─── Assignments ──────────────────────────────────────────────────────────────

export class AssignTaskDto {
  @IsDateString()
  scheduledDate: string; // "YYYY-MM-DD"

  @IsOptional()
  @IsString()
  startTime?: string; // "HH:MM"

  @IsOptional()
  @IsString()
  endTime?: string; // "HH:MM"
}

export class UpdateAssignmentDto {
  @IsOptional()
  @IsDateString()
  scheduledDate?: string; // "YYYY-MM-DD" — used by drag-and-drop to move to a new day

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CarryForwardDto {
  // Target date "YYYY-MM-DD". If omitted, moves to next week (same weekday).
  @IsOptional()
  @IsDateString()
  toDate?: string;

  // If set, assigns the carried task into a different week's plan.
  @IsOptional()
  @IsString()
  toWeekStart?: string; // "YYYY-MM-DD" of target week's Sunday
}

// ─── Reorder ──────────────────────────────────────────────────────────────────

export class ReorderItemDto {
  @IsString()
  id: string;

  @IsInt()
  @Min(0)
  sortOrder: number;
}

export class ReorderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items: ReorderItemDto[];
}

// ─── Notes (coach ↔ participant chat) ─────────────────────────────────────────

export class CreateNoteDto {
  @IsString()
  participantId: string;

  @IsString()
  content: string;

  @IsString()
  senderType: string; // "coach" | "participant"

  @IsOptional()
  @IsString()
  senderName?: string;
}
