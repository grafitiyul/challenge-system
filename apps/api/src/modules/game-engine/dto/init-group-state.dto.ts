import { IsDateString, IsString } from 'class-validator';

export class InitGroupStateDto {
  @IsString()
  groupId: string;

  @IsDateString()
  startDate: string;
}
