import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

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

  // All four catch-up text fields are typed as plain `string` here, not
  // `string | null`. The client always sends a string (empty string when
  // the admin cleared the field); the service normalises "" → null at
  // the DB layer for the nullable columns. Allowing `null` on the wire
  // tripped a class-validator + class-transformer interaction under
  // `whitelist:true + transform:true` that silently stripped the field,
  // so the conditional spread in the service treated it as "untouched"
  // and no value reached the column.
  @IsOptional()
  @IsString()
  catchUpButtonLabel?: string;

  @IsOptional()
  @IsString()
  catchUpConfirmTitle?: string;

  @IsOptional()
  @IsString()
  catchUpConfirmBody?: string;

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
  catchUpBannerText?: string;

  // Asia/Jerusalem YYYY-MM-DD strings on which the button is allowed
  // to appear. Combined with catchUpAllowedWeekdays via the shared
  // availability helper — both empty = button never appears.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true })
  catchUpAvailableDates?: string[];

  // JS-style weekday numbers (0=Sun..6=Sat) on which the catch-up
  // button is available. Service dedups + sorts on write.
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  catchUpAllowedWeekdays?: number[];
}
