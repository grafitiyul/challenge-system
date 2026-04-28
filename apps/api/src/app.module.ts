import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthController } from './health.controller';
import { WassengerModule } from './wassenger.module';
import { SeederService } from './seeder.service';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { ChallengeTypesModule } from './modules/challenge-types/challenge-types.module';
import { GroupsModule } from './modules/groups/groups.module';
import { GendersModule } from './modules/genders/genders.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { QuestionnairesModule } from './modules/questionnaires/questionnaires.module';
import { UploadModule } from './modules/upload/upload.module';
import { ProgramsModule } from './modules/programs/programs.module';
import { ProgramProfileFieldsModule } from './modules/program-profile-fields/program-profile-fields.module';
import { ParticipantProfilePortalModule } from './modules/participant-profile-portal/participant-profile-portal.module';
import { AdminFeedModule } from './modules/admin-feed/admin-feed.module';
import { GameEngineModule } from './modules/game-engine/game-engine.module';
import { ImportModule } from './modules/import/import.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TaskEngineModule } from './modules/task-engine/task-engine.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { OffersModule } from './modules/offers/offers.module';
import { IcountWebhookModule } from './modules/icount-webhook/icount-webhook.module';
import { AdminUsersModule } from './modules/admin-users/admin-users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    WassengerModule,
    AuthModule,
    ChallengesModule,
    ChallengeTypesModule,
    GroupsModule,
    GendersModule,
    ParticipantsModule,
    QuestionnairesModule,
    UploadModule,
    ProgramsModule,
    ProgramProfileFieldsModule,
    ParticipantProfilePortalModule,
    AdminFeedModule,
    GameEngineModule,
    ImportModule,
    SettingsModule,
    TaskEngineModule,
    ProjectsModule,
    PaymentsModule,
    OffersModule,
    IcountWebhookModule,
    AdminUsersModule,
  ],
  controllers: [HealthController],
  providers: [SeederService],
})
export class AppModule {}
