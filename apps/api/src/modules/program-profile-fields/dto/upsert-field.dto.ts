import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Recognised field types. Mirrors what the participant portal will know
// how to render. Add new types here when the portal supports them.
export const PROFILE_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'image', 'imageGallery'] as const;
export type ProfileFieldType = (typeof PROFILE_FIELD_TYPES)[number];

// fieldKey values that map 1:1 to columns on the participants table.
// Submissions for these keys write to Participant directly via the
// shared identity-key handler (mirrors the questionnaire system).
export const SYSTEM_FIELD_KEYS = [
  'firstName', 'lastName', 'phoneNumber', 'email',
  'birthDate', 'city', 'profileImageUrl',
] as const;
export type SystemFieldKey = (typeof SYSTEM_FIELD_KEYS)[number];

// Used by both create + update: every property is optional on update,
// so we re-use the same shape and let the service treat it as a partial.
// Service enforces that fieldKey + fieldType are present on create.
export class UpsertProfileFieldDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  // Stable key. For system fields must be one of SYSTEM_FIELD_KEYS.
  // For custom fields any [a-zA-Z][a-zA-Z0-9_]* style admin-chosen string.
  fieldKey?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  helperText?: string | null;

  @IsOptional()
  @IsIn(PROFILE_FIELD_TYPES as unknown as string[])
  fieldType?: ProfileFieldType;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isSystemField?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
