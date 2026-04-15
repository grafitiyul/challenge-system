import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

/**
 * Apply a correction to an existing (active) UserActionLog.
 * Produces a new superseding log + compensating ScoreEvent + new ScoreEvent, all
 * inside a single transaction. See GameEngineService.correctLog().
 */
export class CorrectLogDto {
  /** id of the currently-active log in the chain. */
  @IsString()
  logId: string;

  /** New raw value. Omit to leave unchanged. */
  @IsOptional()
  @IsString()
  value?: string;

  /** New context payload. Omit to leave unchanged. */
  @IsOptional()
  @IsObject()
  contextJson?: Record<string, unknown>;

  /** Who is performing the correction. */
  @IsIn(['participant', 'admin'])
  actorRole: 'participant' | 'admin';
}

export class VoidLogDto {
  @IsString()
  logId: string;

  @IsIn(['participant', 'admin'])
  actorRole: 'participant' | 'admin';
}
