import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateProgramDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isHidden?: boolean;

  @IsOptional()
  @IsBoolean()
  showIndividualLeaderboard?: boolean;

  @IsOptional()
  @IsBoolean()
  showGroupComparison?: boolean;

  @IsOptional()
  @IsBoolean()
  showOtherGroupsCharts?: boolean;

  @IsOptional()
  @IsBoolean()
  showOtherGroupsMemberDetails?: boolean;

  @IsOptional()
  @IsString()
  rulesContent?: string | null;

  @IsOptional()
  @IsBoolean()
  rulesPublished?: boolean;
}
