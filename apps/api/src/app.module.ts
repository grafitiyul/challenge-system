import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health.controller';
import { WassengerController } from './wassenger.controller';
import { WassengerService } from './wassenger.service';
import { SeederService } from './seeder.service';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { ChallengeTypesModule } from './modules/challenge-types/challenge-types.module';
import { GroupsModule } from './modules/groups/groups.module';
import { GendersModule } from './modules/genders/genders.module';
import { ParticipantsModule } from './modules/participants/participants.module';
import { QuestionnairesModule } from './modules/questionnaires/questionnaires.module';
import { UploadModule } from './modules/upload/upload.module';
import { ProgramsModule } from './modules/programs/programs.module';
import { GameEngineModule } from './modules/game-engine/game-engine.module';
import { ImportModule } from './modules/import/import.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TaskEngineModule } from './modules/task-engine/task-engine.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    ChallengesModule,
    ChallengeTypesModule,
    GroupsModule,
    GendersModule,
    ParticipantsModule,
    QuestionnairesModule,
    UploadModule,
    ProgramsModule,
    GameEngineModule,
    ImportModule,
    SettingsModule,
    TaskEngineModule,
  ],
  controllers: [HealthController, WassengerController],
  providers: [WassengerService, SeederService],
})
export class AppModule {}
