import { IsObject, IsOptional, IsString } from 'class-validator';

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
}
