import { Allow, IsString, MaxLength } from 'class-validator';

// Body for PATCH /api/public/participant/:token/profile/value.
// `value` is intentionally typed as `unknown` so each fieldType can
// validate its own shape server-side (string for text, number for
// number, ISO date for date, file id for image, file id array for
// imageGallery, etc.).
//
// IMPORTANT: the global ValidationPipe runs with
//   { whitelist: true, forbidNonWhitelisted: true }
// in apps/api/src/main.ts. Properties without any class-validator
// decorator are treated as "not declared on the DTO" — stripped, and
// with forbidNonWhitelisted, the request gets rejected with 400
// `property value should not exist`. That broke every save in the
// participant profile tab. @Allow() is the explicit class-validator
// decorator that says "yes, this property exists, accept any value".
// Per-type shape validation still runs server-side in
// ParticipantProfilePortalService.normalise.
export class SetProfileValueDto {
  @IsString()
  @MaxLength(64)
  fieldKey!: string;

  @Allow()
  value!: unknown;
}
