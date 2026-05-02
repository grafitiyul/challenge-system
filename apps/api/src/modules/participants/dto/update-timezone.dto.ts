import { IsString } from 'class-validator';

// IANA timezone identifier, validated against
// Intl.supportedValuesOf('timeZone') in the service. Stored on
// Participant for personal-streak day bucketing only — game streak
// always uses Asia/Jerusalem regardless of this value.
export class UpdateParticipantTimezoneDto {
  @IsString()
  timezone: string;
}
