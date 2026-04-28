import { IsDate, IsObject, IsOptional, IsString } from 'class-validator';

export class LogActionDto {
  @IsString()
  participantId: string;

  @IsString()
  programId: string;

  @IsString()
  actionId: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  /** Raw reported value: "true" | numeric string | option value. */
  @IsOptional()
  @IsString()
  value?: string;

  /**
   * Dimension values conforming to action.contextSchemaJson.
   * Validated by validateContext() in the service.
   */
  @IsOptional()
  @IsObject()
  contextJson?: Record<string, unknown>;

  /**
   * Phase 4.1: optional free-text answer the participant typed for the action's
   * participantTextPrompt. NOT part of contextJson — stored on UserActionLog
   * directly. Capped at 500 chars server-side.
   */
  @IsOptional()
  @IsString()
  extraText?: string;

  /**
   * Idempotency key — typically set from the `Idempotency-Key` HTTP header by the
   * controller, not by direct API callers. Identical keys on the same action /
   * participant are treated as replays and return the original result.
   */
  @IsOptional()
  @IsString()
  clientSubmissionId?: string;

  /**
   * Catch-up mode override. When present, the engine writes UserActionLog,
   * ScoreEvent and FeedEvent with createdAt = creditedAt (typically 12:00
   * Asia/Jerusalem on the credited day). occurredAt remains the
   * wall-clock insertion time via the schema's @default(now()).
   * Set ONLY by the participant-portal service after it has validated an
   * active CatchUpSession; not exposed on the public log DTO.
   */
  @IsOptional()
  @IsDate()
  creditedAt?: Date;

  /**
   * Suffix appended to the FeedEvent.message when a catch-up backdate
   * is in effect (e.g. " (דווח עבור אתמול)"). Composed by the caller.
   * Empty/undefined for normal "today" submissions.
   */
  @IsOptional()
  @IsString()
  messageSuffix?: string;
}
