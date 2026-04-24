import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { PARTICIPANT_MATCHING_MODES, SUBMISSION_PURPOSES } from '../submission-taxonomy';

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  internalName?: string;

  @IsOptional()
  @IsString()
  publicTitle?: string;

  @IsOptional()
  @IsString()
  introRichText?: string;

  @IsOptional()
  @IsIn(['internal', 'external', 'both'])
  usageType?: string;

  @IsOptional()
  @IsIn(['none', 'create_new_participant', 'attach_or_create'])
  submitBehavior?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['step_by_step', 'full_list'])
  displayMode?: string;

  @IsOptional()
  @IsString()
  postIdentificationGreeting?: string;

  @IsOptional()
  @IsString()
  postSubmitText?: string;

  @IsOptional()
  @IsString()
  programId?: string | null;

  // ── Post-submit configuration ────────────────────────────────────────────
  @IsOptional()
  @IsIn(SUBMISSION_PURPOSES as unknown as string[])
  submissionPurpose?: string;

  @IsOptional()
  @IsIn(PARTICIPANT_MATCHING_MODES as unknown as string[])
  participantMatchingMode?: string;

  @IsOptional()
  @IsString()
  onSubmitParticipantStatus?: string | null;

  @IsOptional()
  @IsString()
  onSubmitSource?: string | null;

  @IsOptional()
  @IsString()
  linkedChallengeId?: string | null;

  @IsOptional()
  @IsString()
  linkedGroupId?: string | null;
}
