import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  ParticipantProfilePortalController,
  ParticipantProfileAdminController,
  ParticipantUploadedFileAdminController,
} from './participant-profile-portal.controller';
import { ParticipantProfilePortalService } from './participant-profile-portal.service';

@Module({
  imports: [AuthModule],
  controllers: [
    ParticipantProfilePortalController,
    ParticipantProfileAdminController,
    ParticipantUploadedFileAdminController,
  ],
  providers: [ParticipantProfilePortalService],
})
export class ParticipantProfilePortalModule {}
