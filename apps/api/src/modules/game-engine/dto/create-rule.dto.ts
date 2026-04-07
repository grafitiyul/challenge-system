import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateRuleDto {
  @IsString()
  name: string;

  @IsString()
  type: string; // "daily_bonus" | "streak" | "conditional"

  @IsOptional()
  @IsObject()
  conditionJson?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  rewardJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  activationType?: string; // "immediate" | "after_days" | "admin_unlock"

  @IsOptional()
  @IsInt()
  @Min(1)
  activationDays?: number;

  @IsOptional()
  @IsBoolean()
  requiresAdminApproval?: boolean;
}

export class UpdateRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsObject()
  conditionJson?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  rewardJson?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  activationType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  activationDays?: number;

  @IsOptional()
  @IsBoolean()
  requiresAdminApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
