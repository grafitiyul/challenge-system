import { Module } from '@nestjs/common';
import {
  GameActionsController,
  GameRulesController,
  GameEngineController,
  ContextLibraryController,
} from './game-engine.controller';
import { GameEngineService } from './game-engine.service';
import { ContextLibraryService } from './context-library.service';
import { ParticipantPortalController } from './participant-portal.controller';
import { ParticipantPortalService } from './participant-portal.service';

@Module({
  controllers: [
    GameActionsController,
    GameRulesController,
    GameEngineController,
    ContextLibraryController,
    ParticipantPortalController,
  ],
  providers: [GameEngineService, ContextLibraryService, ParticipantPortalService],
  exports: [GameEngineService, ContextLibraryService],
})
export class GameEngineModule {}
