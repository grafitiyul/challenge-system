import { IsString, IsDateString, IsBoolean, IsOptional } from 'class-validator';

export class CreateChallengeDto {
  @IsString()
  name: string;

  @IsString()
  challengeTypeId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
