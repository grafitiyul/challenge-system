import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

// All four iCount fields are kept in lockstep with the schema's
// PaymentOffer columns (iCountPaymentUrl / iCountPageId /
// iCountItemName / iCountExternalId). The global ValidationPipe
// runs with `forbidNonWhitelisted: true`, so any column that's
// missing from this DTO causes the entire save to be rejected as
// "property X should not exist" — the cause of the
// "שמירה נכשלה" symptom on the admin edit modal. Add a field here
// whenever a column is added to PaymentOffer.

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
  iCountPageId?: string | null;

  @IsOptional()
  @IsString()
  iCountItemName?: string | null;

  @IsOptional()
  @IsString()
  iCountExternalId?: string | null;

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
  iCountPageId?: string | null;

  @IsOptional()
  @IsString()
  iCountItemName?: string | null;

  @IsOptional()
  @IsString()
  iCountExternalId?: string | null;

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
