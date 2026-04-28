import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminFeedController } from './admin-feed.controller';
import { AdminFeedService } from './admin-feed.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminFeedController],
  providers: [AdminFeedService],
})
export class AdminFeedModule {}
