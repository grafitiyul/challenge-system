import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WhatsappBridgeModule } from '../whatsapp-bridge/whatsapp-bridge.module';
import { GroupScheduledMessagesController } from './group-messages.controller';
import { GroupScheduledMessagesService } from './group-messages.service';
import {
  GroupParticipantsScheduledCountsController,
  ParticipantPrivateMessagesController,
} from './private-messages.controller';
import { PrivateScheduledMessagesService } from './private-messages.service';
import { PrivateScheduledMessagesWorker } from './private-messages.worker';
import { ScheduledMessagesWorker } from './scheduled-messages.worker';

// Source-of-truth note: the program-level "templates" surface lives
// inside the ProgramsModule on CommunicationTemplate ("נוסחים להודעות").
// This module owns:
//   - the group-level sending control + cron worker
//   - the participant-private-DM scheduling surface + its sibling
//     cron worker (single source of truth for upcoming private DMs,
//     keyed on participantId only — see PrivateScheduledMessage model)
// Both workers share constants via scheduled-messages-shared.ts so
// queue behavior (claim TTL, retry schedule, batch size) stays in
// lockstep. The duplicate templates module that used to live here was
// retired in the comm-templates merge.

@Module({
  imports: [AuthModule, WhatsappBridgeModule],
  controllers: [
    GroupScheduledMessagesController,
    ParticipantPrivateMessagesController,
    GroupParticipantsScheduledCountsController,
  ],
  providers: [
    GroupScheduledMessagesService,
    PrivateScheduledMessagesService,
    ScheduledMessagesWorker,
    PrivateScheduledMessagesWorker,
  ],
})
export class ScheduledMessagesModule {}
