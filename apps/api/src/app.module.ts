import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health.controller';
import { ChallengesModule } from './modules/challenges/challenges.module';
import { ChallengeTypesModule } from './modules/challenge-types/challenge-types.module';
import { GroupsModule } from './modules/groups/groups.module';
import { GendersModule } from './modules/genders/genders.module';
import { ParticipantsModule } from './modules/participants/participants.module';

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
  ],
  controllers: [HealthController],
})
export class AppModule {}
