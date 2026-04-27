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

  // Phase 7 — gates the participant-portal "פרטים אישיים" tab. When
  // false (default) participants do not see the tab at all.
  @IsOptional()
  @IsBoolean()
  profileTabEnabled?: boolean;
}
