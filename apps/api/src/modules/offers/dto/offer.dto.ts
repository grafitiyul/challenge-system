import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

export class CreateOfferDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  iCountPaymentUrl?: string | null;

  @IsOptional()
  @IsString()
  linkedChallengeId?: string | null;

  @IsOptional()
  @IsString()
  linkedProgramId?: string | null;

  @IsOptional()
  @IsString()
  defaultGroupId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateOfferDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  iCountPaymentUrl?: string | null;

  @IsOptional()
  @IsString()
  linkedChallengeId?: string | null;

  @IsOptional()
  @IsString()
  linkedProgramId?: string | null;

  @IsOptional()
  @IsString()
  defaultGroupId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
