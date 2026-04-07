import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateOptionDto {
  @IsString()
  label: string;

  @IsString()
  value: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
