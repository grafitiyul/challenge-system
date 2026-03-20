import { IsString, IsOptional, IsInt } from 'class-validator';

export class CreateChallengeTypeDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsInt()
  @IsOptional()
  sortOrder?: number;
}
