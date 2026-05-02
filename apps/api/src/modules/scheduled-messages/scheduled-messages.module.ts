import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WhatsappBridgeModule } from '../whatsapp-bridge/whatsapp-bridge.module';
import { ScheduledMessageTemplatesController } from './templates.controller';
import { ScheduledMessageTemplatesService } from './templates.service';
import { GroupScheduledMessagesController } from './group-messages.controller';
import { GroupScheduledMessagesService } from './group-messages.service';
import { ScheduledMessagesWorker } from './scheduled-messages.worker';

@Module({
  imports: [AuthModule, WhatsappBridgeModule],
  controllers: [
    ScheduledMessageTemplatesController,
    GroupScheduledMessagesController,
  ],
  providers: [
    ScheduledMessageTemplatesService,
    GroupScheduledMessagesService,
    ScheduledMessagesWorker,
  ],
})
export class ScheduledMessagesModule {}
