import { IsOptional, IsString } from 'class-validator';

export class LogActionDto {
  @IsString()
  participantId: string;

  @IsString()
  programId: string;

  @IsString()
  actionId: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  value?: string; // "true" | numeric string | option value
}
