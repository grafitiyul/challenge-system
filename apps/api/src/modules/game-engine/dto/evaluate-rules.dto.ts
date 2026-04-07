import { IsOptional, IsString } from 'class-validator';

export class EvaluateRulesDto {
  @IsString()
  participantId: string;

  @IsString()
  programId: string;

  @IsOptional()
  @IsString()
  groupId?: string;
}
