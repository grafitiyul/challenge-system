import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ProgramType } from '@prisma/client';

export class CreateProgramDto {
  @IsString()
  name: string;

  @IsEnum(ProgramType)
  type: ProgramType;

  @IsOptional()
  @IsString()
  description?: string;
}
