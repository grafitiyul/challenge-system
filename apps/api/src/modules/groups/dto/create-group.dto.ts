import { IsString, IsDateString } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  name: string;

  @IsString()
  challengeId: string;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;
}
