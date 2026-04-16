import { IsOptional, IsString } from 'class-validator';

export class CreateAnalyticsGroupDto {
  @IsString()
  label: string;
}

export class UpdateAnalyticsGroupDto {
  @IsOptional()
  @IsString()
  label?: string;
}
