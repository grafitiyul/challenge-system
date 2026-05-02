import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WhatsappBridgeModule } from '../whatsapp-bridge/whatsapp-bridge.module';
import { GroupScheduledMessagesController } from './group-messages.controller';
import { GroupScheduledMessagesService } from './group-messages.service';
import { ScheduledMessagesWorker } from './scheduled-messages.worker';

// Source-of-truth note: the program-level "templates" surface lives
// inside the ProgramsModule on CommunicationTemplate ("נוסחים להודעות").
// This module owns ONLY the group-level sending control + the cron
// worker. The duplicate templates module that used to live here was
// retired in the comm-templates merge.

@Module({
  imports: [AuthModule, WhatsappBridgeModule],
  controllers: [
    GroupScheduledMessagesController,
  ],
  providers: [
    GroupScheduledMessagesService,
    ScheduledMessagesWorker,
  ],
})
export class ScheduledMessagesModule {}
