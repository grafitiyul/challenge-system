import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

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
  @IsInt()
  @Min(1)
  maxPerDay?: number;
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
  @IsInt()
  @Min(1)
  maxPerDay?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
