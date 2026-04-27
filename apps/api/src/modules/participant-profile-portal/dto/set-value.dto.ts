import { IsString, MaxLength } from 'class-validator';

// Body for PATCH /api/portal/profile/:token/value.
// `value` is intentionally typed as `unknown` so each fieldType can
// validate its own shape server-side (string for text, number for
// number, ISO date for date, file id for image, file id array for
// imageGallery, etc.).
export class SetProfileValueDto {
  @IsString()
  @MaxLength(64)
  fieldKey!: string;

  // class-validator's typing forces a known type, so we accept unknown
  // here and have the service hand off to fieldType-specific validators.
  // Empty / null clears the value.
  value!: unknown;
}
