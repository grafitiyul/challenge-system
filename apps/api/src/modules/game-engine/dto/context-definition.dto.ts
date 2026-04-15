import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Option row for a select-type reusable context.
 * Value is either admin-provided or auto-slugified server-side from the label
 * (same pipeline as Phase 3.1 auto-keys).
 */
export class ContextDefinitionOptionDto {
  @IsString()
  label: string;

  @IsOptional()
  @IsString()
  value?: string;
}

export class CreateContextDefinitionDto {
  @IsString()
  label: string;

  @IsIn(['select', 'text', 'number'])
  type: 'select' | 'text' | 'number';

  @IsOptional()
  @IsBoolean()
  requiredByDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleToParticipantByDefault?: boolean;

  /** Required for type='select'. Ignored for other types. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContextDefinitionOptionDto)
  options?: ContextDefinitionOptionDto[];
}

export class UpdateContextDefinitionDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  requiredByDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleToParticipantByDefault?: boolean;

  /**
   * Replaces the full options list for a select definition. Each existing
   * option's `value` should be passed through verbatim to keep historical
   * participant data attributable; new options without a value get one
   * auto-derived from the label.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContextDefinitionOptionDto)
  options?: ContextDefinitionOptionDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Attachment row inside an action update. Reconciliation is replace-all:
 * whichever `definitionId`s are present become the action's attached set in
 * the given order; anything not listed is detached.
 */
export class ActionContextUseDto {
  @IsString()
  definitionId: string;

  @IsOptional()
  @IsBoolean()
  requiredOverride?: boolean | null;

  @IsOptional()
  @IsBoolean()
  visibleToParticipantOverride?: boolean | null;
}

// Reorder uses the existing ReorderItemDto / ReorderItemsDto from create-action.dto.
