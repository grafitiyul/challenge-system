import { Module } from '@nestjs/common';
import {
  GameActionsController,
  GameRulesController,
  GameEngineController,
  ContextLibraryController,
  AnalyticsGroupController,
} from './game-engine.controller';
import { GameEngineService } from './game-engine.service';
import { ContextLibraryService } from './context-library.service';
import { AnalyticsGroupService } from './analytics-group.service';
import { ParticipantPortalController } from './participant-portal.controller';
import { ParticipantPortalService } from './participant-portal.service';

@Module({
  controllers: [
    GameActionsController,
    GameRulesController,
    GameEngineController,
    ContextLibraryController,
    AnalyticsGroupController,
    ParticipantPortalController,
  ],
  providers: [
    GameEngineService,
    ContextLibraryService,
    AnalyticsGroupService,
    ParticipantPortalService,
  ],
  exports: [GameEngineService, ContextLibraryService, AnalyticsGroupService],
})
export class GameEngineModule {}
