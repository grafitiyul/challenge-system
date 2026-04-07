import { IsEnum, IsOptional, IsString } from 'class-validator';
import { GroupStatus } from '@prisma/client';

export class CreateProgramGroupDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsEnum(GroupStatus)
  status?: GroupStatus;
}
