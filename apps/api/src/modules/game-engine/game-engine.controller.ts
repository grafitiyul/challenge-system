import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { GameEngineService } from './game-engine.service';
import { CreateActionDto, UpdateActionDto, ReorderItemsDto } from './dto/create-action.dto';
import { CreateRuleDto, UpdateRuleDto } from './dto/create-rule.dto';
import { LogActionDto } from './dto/log-action.dto';
import { EvaluateRulesDto } from './dto/evaluate-rules.dto';
import { UnlockRuleDto } from './dto/unlock-rule.dto';
import { InitGroupStateDto } from './dto/init-group-state.dto';

// ─── Actions ─────────────────────────────────────────────────────────────────

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

@Controller('game')
export class GameEngineController {
  constructor(private readonly svc: GameEngineService) {}

  // POST /api/game/actions/log
  @Post('actions/log')
  logAction(@Body() dto: LogActionDto) {
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
}
