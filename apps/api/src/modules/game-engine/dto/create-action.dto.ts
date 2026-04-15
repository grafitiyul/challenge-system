import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Min, ValidateIf, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

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
   * Phase 3: context dimensions schema. Free-form JSON validated by the service
   * via context-validation parseSchema(). Shape:
   *   { dimensions: [{ key, label, type, required?, options?, min?, max? }] }
   * Pass `null` to clear an existing schema. Server bumps contextSchemaVersion
   * on every change so historical UserActionLogs remain attributable to the
   * schema that was in force at write time.
   */
  @IsOptional()
  @IsObject()
  contextSchemaJson?: Record<string, unknown> | null;
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

  /** See CreateActionDto.contextSchemaJson. Pass null to clear. */
  @IsOptional()
  @IsObject()
  contextSchemaJson?: Record<string, unknown> | null;
}
