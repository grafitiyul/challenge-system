import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';

// Curated list — UI offers these as quick-pick chips. Free-form
// strings are also allowed via @IsString(); the controller doesn't
// enforce membership in this list. Centralised here so admin UI
// and any documentation can share the source of truth.
export const SUGGESTED_CATEGORIES = [
  'משחק שוטף',
  'לפני משחק',
  'פתיחה',
  'סיום',
  'תזכורת',
  'מותאם אישית',
] as const;

export const TIMING_TYPES = ['exact', 'day_of', 'before_start', 'after_end'] as const;
export type TimingType = (typeof TIMING_TYPES)[number];

export class CreateTemplateDto {
  @IsString()
  category: string;

  @IsString()
  internalName: string;

  @IsString()
  content: string;

  @IsIn(TIMING_TYPES as readonly string[])
  timingType: TimingType;

  // Required when timingType='exact'. Validated for absence in other
  // modes by the service rather than here so a failing combination
  // surfaces with a meaningful Hebrew message.
  @IsOptional()
  @IsISO8601()
  exactAt?: string;

  // Required when timingType='day_of'. 1-based — day 1 = group.startDate.
  @IsOptional()
  @ValidateIf((o) => o.dayOfNumber !== null && o.dayOfNumber !== undefined)
  @IsInt()
  @Min(1)
  dayOfNumber?: number | null;

  // Required when timingType in ('before_start', 'after_end'). Positive integer.
  @IsOptional()
  @ValidateIf((o) => o.offsetDays !== null && o.offsetDays !== undefined)
  @IsInt()
  @Min(0)
  offsetDays?: number | null;

  // Required for non-exact timing. "HH:mm" 24h Asia/Jerusalem.
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'timeOfDay must be HH:mm (24h)',
  })
  timeOfDay?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() internalName?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsIn(TIMING_TYPES as readonly string[]) timingType?: TimingType;
  @IsOptional() @IsISO8601() exactAt?: string | null;
  @IsOptional() @IsInt() @Min(1) dayOfNumber?: number | null;
  @IsOptional() @IsInt() @Min(0) offsetDays?: number | null;
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/)
  timeOfDay?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
