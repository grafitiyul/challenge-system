import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

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

  // ── Catch-up mode ───────────────────────────────────────────────────────
  // Master kill switch. When false the button never appears, even if
  // catchUpAvailableDates contains today's local Asia/Jerusalem date.
  @IsOptional()
  @IsBoolean()
  catchUpEnabled?: boolean;

  @IsOptional()
  @IsString()
  catchUpButtonLabel?: string;

  @IsOptional()
  @IsString()
  catchUpConfirmTitle?: string | null;

  @IsOptional()
  @IsString()
  catchUpConfirmBody?: string | null;

  // Wall-clock minutes — snapshotted onto the session row at start so
  // editing this mid-session doesn't change a running countdown.
  @IsOptional()
  @IsInt()
  @Min(1)
  catchUpDurationMinutes?: number;

  // 1 = today + yesterday only. Validated server-side; the admin form
  // also clamps client-side. 0 would mean "no backdating" — meaningless
  // (just turn the master flag off), so floor at 1.
  @IsOptional()
  @IsInt()
  @Min(1)
  catchUpAllowedDaysBack?: number;

  @IsOptional()
  @IsString()
  catchUpBannerText?: string | null;

  // Asia/Jerusalem YYYY-MM-DD strings on which the button is allowed
  // to appear. Empty array = button never appears (safe default).
  // Each entry validated as YYYY-MM-DD; service dedups + sorts.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true })
  catchUpAvailableDates?: string[];
}
