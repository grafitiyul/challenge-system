import { Module } from '@nestjs/common';
import {
  GameActionsController,
  GameRulesController,
  GameEngineController,
} from './game-engine.controller';
import { GameEngineService } from './game-engine.service';
import { ParticipantPortalController } from './participant-portal.controller';
import { ParticipantPortalService } from './participant-portal.service';

@Module({
  controllers: [GameActionsController, GameRulesController, GameEngineController, ParticipantPortalController],
  providers: [GameEngineService, ParticipantPortalService],
  exports: [GameEngineService],
})
export class GameEngineModule {}
