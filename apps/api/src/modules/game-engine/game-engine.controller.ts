import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { GameEngineService } from './game-engine.service';
import { ContextLibraryService } from './context-library.service';
import { CreateActionDto, UpdateActionDto, ReorderItemsDto } from './dto/create-action.dto';
import {
  CreateContextDefinitionDto,
  UpdateContextDefinitionDto,
} from './dto/context-definition.dto';
import { CreateRuleDto, UpdateRuleDto } from './dto/create-rule.dto';
import { LogActionDto } from './dto/log-action.dto';
import { EvaluateRulesDto } from './dto/evaluate-rules.dto';
import { UnlockRuleDto } from './dto/unlock-rule.dto';
import { InitGroupStateDto } from './dto/init-group-state.dto';

// ─── Actions ─────────────────────────────────────────────────────────────────

@UseGuards(AdminSessionGuard)
@Controller('game/programs/:programId/actions')
export class GameActionsController {
  constructor(private readonly svc: GameEngineService) {}

  @Get()
  list(@Param('programId') programId: string) {
    return this.svc.listActions(programId);
  }

  @Post()
  create(@Param('programId') programId: string, @Body() dto: CreateActionDto) {
    return this.svc.createAction(programId, dto);
  }

  @Post('reorder')
  reorder(@Param('programId') programId: string, @Body() dto: ReorderItemsDto) {
    return this.svc.reorderActions(programId, dto.items);
  }

  @Patch(':actionId')
  update(@Param('actionId') actionId: string, @Body() dto: UpdateActionDto) {
    return this.svc.updateAction(actionId, dto);
  }

  @Delete(':actionId')
  delete(@Param('actionId') actionId: string) {
    return this.svc.deleteAction(actionId);
  }
}

// ─── Rules ────────────────────────────────────────────────────────────────────

@UseGuards(AdminSessionGuard)
@Controller('game/programs/:programId/rules')
export class GameRulesController {
  constructor(private readonly svc: GameEngineService) {}

  @Get()
  list(@Param('programId') programId: string) {
    return this.svc.listRules(programId);
  }

  @Post()
  create(@Param('programId') programId: string, @Body() dto: CreateRuleDto) {
    return this.svc.createRule(programId, dto);
  }

  @Post('reorder')
  reorder(@Param('programId') programId: string, @Body() dto: ReorderItemsDto) {
    return this.svc.reorderRules(programId, dto.items);
  }

  @Patch(':ruleId')
  update(@Param('ruleId') ruleId: string, @Body() dto: UpdateRuleDto) {
    return this.svc.updateRule(ruleId, dto);
  }

  @Delete(':ruleId')
  delete(@Param('ruleId') ruleId: string) {
    return this.svc.deleteRule(ruleId);
  }
}

// ─── Core game operations ─────────────────────────────────────────────────────

@UseGuards(AdminSessionGuard)
@Controller('game')
export class GameEngineController {
  constructor(private readonly svc: GameEngineService) {}

  // POST /api/game/actions/log
  //
  // Accepts the optional HTTP header `Idempotency-Key`. If the same key is
  // resent for an already-processed submission, the original result is returned
  // and no duplicate ScoreEvent is created. Header takes precedence over any
  // clientSubmissionId already on the DTO body.
  @Post('actions/log')
  logAction(
    @Body() dto: LogActionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (idempotencyKey) dto.clientSubmissionId = idempotencyKey;
    return this.svc.logAction(dto);
  }

  // POST /api/game/rules/evaluate
  @Post('rules/evaluate')
  evaluateRules(@Body() dto: EvaluateRulesDto) {
    return this.svc.evaluateRules(dto);
  }

  // GET /api/game/score/summary?participantId=&programId=
  @Get('score/summary')
  scoreSummary(
    @Query('participantId') participantId: string,
    @Query('programId') programId: string,
  ) {
    return this.svc.getScoreSummary(participantId, programId);
  }

  // GET /api/game/feed?groupId=&limit=
  @Get('feed')
  feed(
    @Query('groupId') groupId: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getFeed(groupId, limit ? parseInt(limit) : 20);
  }

  // POST /api/game/admin/unlock-rule
  @Post('admin/unlock-rule')
  unlockRule(@Body() dto: UnlockRuleDto) {
    return this.svc.unlockRule(dto);
  }

  // POST /api/game/groups/init-state
  @Post('groups/init-state')
  initGroupState(@Body() dto: InitGroupStateDto) {
    return this.svc.initGroupState(dto);
  }

  // GET /api/game/groups/:groupId/state
  @Get('groups/:groupId/state')
  getGroupState(@Param('groupId') groupId: string) {
    return this.svc.getGroupState(groupId);
  }

  // GET /api/game/leaderboard/group/:groupId
  @Get('leaderboard/group/:groupId')
  groupLeaderboard(@Param('groupId') groupId: string) {
    return this.svc.getGroupLeaderboard(groupId);
  }

  // GET /api/game/leaderboard/program/:programId/groups
  @Get('leaderboard/program/:programId/groups')
  programGroupRanking(@Param('programId') programId: string) {
    return this.svc.getProgramGroupRanking(programId);
  }

  // GET /api/game/leaderboard/program/:programId/summary
  @Get('leaderboard/program/:programId/summary')
  programSummary(@Param('programId') programId: string) {
    return this.svc.getProgramSummary(programId);
  }

  // GET /api/game/admin/participant-stats?participantId=&groupId=
  @Get('admin/participant-stats')
  adminParticipantStats(
    @Query('participantId') participantId: string,
    @Query('groupId') groupId: string,
  ) {
    return this.svc.getAdminParticipantStats(participantId, groupId);
  }

  // GET /api/game/admin/feed?groupId=&participantId=&limit=
  @Get('admin/feed')
  adminFeed(
    @Query('groupId') groupId: string,
    @Query('participantId') participantId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.getAdminFeed(groupId, participantId, limit ? parseInt(limit) : 50);
  }

  // DELETE /api/game/admin/feed/:feedEventId — DISABLED (returns 410)
  // The underlying service throws GoneException. Admin UIs that still wire this
  // endpoint will surface a hard failure, which is the intended behavior.
  @Delete('admin/feed/:feedEventId')
  deleteFeedEvent(@Param('feedEventId') feedEventId: string) {
    return this.svc.deleteFeedEvent(feedEventId);
  }

  // POST /api/game/admin/feed/bulk-delete — DISABLED (returns 410)
  @Post('admin/feed/bulk-delete')
  bulkDeleteFeedEvents(@Body() body: { ids: string[] }) {
    return this.svc.bulkDeleteFeedEvents(body.ids);
  }

  // GET /api/game/admin/bypass-link?accessToken=xxx
  // Returns an HMAC sig that lets an admin open the portal bypassing the opening gate.
  // Scoped to a single access token (one participant-group link) — does not affect the group.
  @Get('admin/bypass-link')
  getBypassLink(@Query('accessToken') accessToken: string) {
    return this.svc.getBypassLink(accessToken);
  }

  // POST /api/game/admin/reset-participant — DISABLED (returns 410)
  // Previously hard-deleted all FeedEvents, ScoreEvents, and UserActionLogs for a
  // participant. Violates the Phase 1 immutable-ledger invariant. Now throws 410;
  // a future admin tool must compose voidLog over active chain heads instead.
  @Post('admin/reset-participant')
  resetParticipantProgress(
    @Query('participantId') participantId: string,
    @Query('groupId') groupId: string,
  ) {
    return this.svc.resetParticipantProgress(participantId, groupId);
  }
}

// ─── Phase 3.2: Reusable context library ───────────────────────────────────
// Program-scoped CRUD for context definitions. Attachment of a definition to
// a specific action is handled through the existing action update path (the
// action DTO accepts a `contextUses` list that the service reconciles).

@UseGuards(AdminSessionGuard)
@Controller('game/programs/:programId/context-definitions')
export class ContextLibraryController {
  constructor(private readonly svc: ContextLibraryService) {}

  @Get()
  list(
    @Param('programId') programId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.svc.list(programId, includeArchived !== 'false');
  }

  @Post()
  create(
    @Param('programId') programId: string,
    @Body() dto: CreateContextDefinitionDto,
  ) {
    return this.svc.create(programId, dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateContextDefinitionDto,
  ) {
    return this.svc.update(id, dto);
  }

  // Archiving is preferred to deletion — historical UserActionLog rows keep
  // resolving to an archived definition's schema.
  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.svc.archive(id);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.svc.restore(id);
  }

  @Post('reorder')
  reorder(
    @Param('programId') programId: string,
    @Body() body: ReorderItemsDto,
  ) {
    return this.svc.reorder(programId, body.items);
  }

  // ─── Attach actions from the context side ────────────────────────────────
  // Parallel to the action-editor attachment flow. Overrides remain in the
  // action editor — attaching from here creates a GameActionContextUse row
  // with both override fields set to null (inherit definition defaults).

  @Get(':id/attached-actions')
  listAttachedActions(@Param('id') id: string) {
    return this.svc.listAttachedActions(id);
  }

  @Post(':id/attach-action')
  attachToAction(
    @Param('id') id: string,
    @Body() body: { actionId: string },
  ) {
    return this.svc.attachToAction(id, body.actionId);
  }

  @Delete(':id/attach-action/:actionId')
  detachFromAction(
    @Param('id') id: string,
    @Param('actionId') actionId: string,
  ) {
    return this.svc.detachFromAction(id, actionId);
  }
}
