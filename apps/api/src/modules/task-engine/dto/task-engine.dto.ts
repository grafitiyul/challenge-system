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
