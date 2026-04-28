import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GameEngineModule } from '../game-engine/game-engine.module';
import { AdminFeedController } from './admin-feed.controller';
import { AdminFeedService } from './admin-feed.service';

@Module({
  imports: [AuthModule, GameEngineModule],
  controllers: [AdminFeedController],
  providers: [AdminFeedService],
})
export class AdminFeedModule {}
