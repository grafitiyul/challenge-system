import { IsOptional, IsString } from 'class-validator';

export class EvaluateRulesDto {
  @IsString()
  participantId: string;

  @IsString()
  programId: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  /**
   * Internal: when evaluateRules is triggered by a specific action submission,
   * this is the id of that action's ScoreEvent. Rule-emitted ScoreEvents set
   * parentEventId = triggeringEventId so the correction cascade can find them.
   * Not user-supplied — set by logAction() / correctLog().
   */
  @IsOptional()
  @IsString()
  triggeringEventId?: string;
}
