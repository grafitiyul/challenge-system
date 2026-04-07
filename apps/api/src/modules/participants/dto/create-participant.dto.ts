import { IsDateString, IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateParticipantDto {
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsString()
  phoneNumber: string;

  // Frontend sends genderName; backend resolves to ID (find-or-create)
  @IsString()
  genderName: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  groupId?: string;
}
