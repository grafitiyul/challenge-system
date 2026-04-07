import { Module } from '@nestjs/common';
import {
  GameActionsController,
  GameRulesController,
  GameEngineController,
} from './game-engine.controller';
import { GameEngineService } from './game-engine.service';

@Module({
  controllers: [GameActionsController, GameRulesController, GameEngineController],
  providers: [GameEngineService],
  exports: [GameEngineService],
})
export class GameEngineModule {}
