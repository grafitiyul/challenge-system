import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AnswerInputDto {
  @IsString()
  questionId: string;

  // Any JSON-serializable value: string, number, string[], null
  // @IsOptional whitelists the property so ValidationPipe doesn't strip/reject it
  @IsOptional()
  value: unknown;
}

export class NewParticipantDto {
  @IsString()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsString()
  phoneNumber: string;

  @IsOptional()
  @IsString()
  email?: string;
}

export class CreateSubmissionDto {
  @IsIn(['internal', 'external'])
  submittedByMode: string;

  @IsOptional()
  @IsString()
  participantId?: string;

  @IsOptional()
  @IsString()
  externalLinkId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerInputDto)
  answers: AnswerInputDto[];

  // Provided when submitBehavior requires participant creation and no participantId is known
  @IsOptional()
  @ValidateNested()
  @Type(() => NewParticipantDto)
  newParticipant?: NewParticipantDto;
}
