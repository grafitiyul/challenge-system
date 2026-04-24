import { IsBoolean, IsISO8601, IsOptional, IsString } from 'class-validator';

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  startDate?: string | null;

  @IsOptional()
  @IsString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  @IsOptional()
  @IsBoolean()
  taskEngineEnabled?: boolean;

  // Portal opening flow — UTC ISO strings; null clears the field
  @IsOptional()
  @IsISO8601()
  portalCallTime?: string | null;

  @IsOptional()
  @IsISO8601()
  portalOpenTime?: string | null;
}
