import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export const PRODUCT_KINDS = [
  'game',
  'challenge',
  'group_coaching',
  'personal_coaching',
  'other',
] as const;

export class CreateProductDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(PRODUCT_KINDS as unknown as string[])
  kind?: (typeof PRODUCT_KINDS)[number];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsIn(PRODUCT_KINDS as unknown as string[])
  kind?: (typeof PRODUCT_KINDS)[number];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ─── Waitlist ────────────────────────────────────────────────────────────────

export class AddWaitlistEntryDto {
  @IsString()
  participantId: string;

  @IsOptional()
  @IsString()
  source?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;
}

// ─── Communication templates ────────────────────────────────────────────────

export const TEMPLATE_CHANNELS = ['email', 'whatsapp'] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

export class CreateCommunicationTemplateDto {
  @IsIn(TEMPLATE_CHANNELS as unknown as string[])
  channel: TemplateChannel;

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  subject?: string | null;

  @IsString()
  body: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCommunicationTemplateDto {
  @IsOptional()
  @IsIn(TEMPLATE_CHANNELS as unknown as string[])
  channel?: TemplateChannel;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  subject?: string | null;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
