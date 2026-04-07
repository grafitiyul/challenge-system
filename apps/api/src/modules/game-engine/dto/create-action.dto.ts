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
