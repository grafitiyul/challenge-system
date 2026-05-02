import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
} from 'class-validator';

// V1: only group_whatsapp_chat. V2 will add 'each_participant'.
export const TARGET_TYPES = ['group_whatsapp_chat'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export class CreateGroupMessageDto {
  @IsString()
  category: string;

  @IsString()
  internalName: string;

  @IsString()
  content: string;

  // ISO8601 in UTC. Frontend converts the admin's Asia/Jerusalem
  // wall-clock pick to UTC before sending; service stores as-is.
  @IsISO8601()
  scheduledAt: string;

  @IsOptional()
  @IsIn(TARGET_TYPES as readonly string[])
  targetType?: TargetType;

  // Defaults false on create — admin must explicitly enable. Combined
  // with status='draft' on creation, this means no row ever sends
  // without an explicit admin action.
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateGroupMessageDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() internalName?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsISO8601() scheduledAt?: string;
  @IsOptional() @IsIn(TARGET_TYPES as readonly string[]) targetType?: TargetType;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class InheritFromProgramDto {
  // Omit / empty array = inherit ALL active templates of the group's
  // program. Otherwise restrict to the listed ids. The service skips
  // templates that would produce a duplicate (same group + same
  // template + same scheduledAt) and reports them in the response.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  templateIds?: string[];
}

export class SetGroupMasterToggleDto {
  @IsBoolean()
  scheduledMessagesEnabled: boolean;
}
