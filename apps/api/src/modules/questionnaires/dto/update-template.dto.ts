import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

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
}
