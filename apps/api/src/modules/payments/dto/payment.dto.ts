import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';

// Free-form on the wire — keeps a future iCount webhook writing "icount"
// rows alongside manually-entered rows with no DTO change.
export const PAYMENT_PROVIDERS = ['manual', 'icount', 'other'] as const;
export const PAYMENT_STATUSES = ['paid', 'pending', 'refunded', 'failed'] as const;

export class CreatePaymentDto {
  @IsOptional()
  @IsIn(PAYMENT_PROVIDERS as unknown as string[])
  provider?: (typeof PAYMENT_PROVIDERS)[number];

  @IsOptional()
  @IsString()
  externalPaymentId?: string | null;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsDateString()
  paidAt: string;

  @IsOptional()
  @IsIn(PAYMENT_STATUSES as unknown as string[])
  status?: (typeof PAYMENT_STATUSES)[number];

  @IsString()
  itemName: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  invoiceUrl?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class UpdatePaymentDto {
  @IsOptional()
  @IsIn(PAYMENT_PROVIDERS as unknown as string[])
  provider?: (typeof PAYMENT_PROVIDERS)[number];

  @IsOptional()
  @IsString()
  externalPaymentId?: string | null;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsIn(PAYMENT_STATUSES as unknown as string[])
  status?: (typeof PAYMENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  itemName?: string;

  @IsOptional()
  @IsString()
  invoiceNumber?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  invoiceUrl?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}
