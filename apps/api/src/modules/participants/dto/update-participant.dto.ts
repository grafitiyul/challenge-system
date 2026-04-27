import { IsBoolean, IsDateString, IsEmail, IsOptional, IsString } from 'class-validator';

export class UpdateParticipantDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  nextAction?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  profileImageUrl?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsBoolean()
  canManageProjects?: boolean;

  // Phase 8 — explicit opt-in for the multi-group switcher in /t/:token.
  // Default false; admin flips per participant.
  @IsOptional()
  @IsBoolean()
  multiGroupEnabled?: boolean;
}
