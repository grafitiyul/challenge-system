import { IsOptional, IsString } from 'class-validator';

export class UnlockRuleDto {
  @IsString()
  groupId: string;

  @IsString()
  ruleId: string;

  @IsOptional()
  @IsString()
  unlockedBy?: string;
}
