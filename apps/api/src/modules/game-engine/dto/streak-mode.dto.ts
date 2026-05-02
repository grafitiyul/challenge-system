import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Single endpoint, three modes — the same DTO shape covers all of:
//   "fresh"    — default. Game streak starts at 0; portal hides
//                personal streak/history and "סה״כ נקודות".
//   "continue" — pure UX flag. Game streak still 0, but portal shows
//                personal streak/history alongside.
//   "override" — admin set a starting streak number. value/reason
//                meaningful only in this mode.
//
// Service-side: when mode='override' we require value to be present;
// when mode∈{fresh,continue} we ignore value/reason and clear the
// existing override columns.
export class SetStreakModeDto {
  @IsIn(['fresh', 'continue', 'override'])
  mode: 'fresh' | 'continue' | 'override';

  // Required only when mode='override'. The service throws BadRequest
  // if mode='override' and value is missing/non-numeric. Sanity-bound
  // 0..9999 so a typo can't produce a 5-digit streak that no one
  // would believe.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  value?: number;

  // Optional human-readable note. Surfaced in the admin participant
  // profile audit row + in the override-mode summary on the modal.
  // Only stored when mode='override'; ignored otherwise.
  @IsOptional()
  @IsString()
  reason?: string;
}
