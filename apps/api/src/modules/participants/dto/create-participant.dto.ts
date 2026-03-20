import { IsString } from 'class-validator';

export class CreateParticipantDto {
  @IsString()
  fullName: string;

  @IsString()
  phoneNumber: string;

  @IsString()
  genderId: string;

  @IsString()
  groupId: string;
}
