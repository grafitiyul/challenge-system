import { IsISO8601, IsOptional, IsString } from 'class-validator';

// Create a new scheduled private DM. Body must include scheduledAt
// (UTC ISO8601 — admin's Asia/Jerusalem wall-clock is converted on the
// frontend before send) and content. participantId comes from the URL.
// Participant phone is NOT taken from the body — the service snapshots
// participant.phoneNumber at create time so a later phone change can't
// silently retarget the message.
export class CreatePrivateScheduledMessageDto {
  @IsString()
  content: string;

  @IsISO8601()
  scheduledAt: string;
}

// Patch a pending private DM. content + scheduledAt are the only
// editable fields. Refused by the service if status≠'pending' or the
// row is currently claimed by an in-flight worker.
export class UpdatePrivateScheduledMessageDto {
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsISO8601() scheduledAt?: string;
}

// Send-now passthrough. NOT a scheduled row — the service calls the
// bridge directly and returns the bridge's response. Outbound
// persistence happens in the bridge (WhatsAppMessage row with
// direction='outgoing').
export class SendNowDto {
  @IsString()
  content: string;
}
