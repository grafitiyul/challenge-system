import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
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
