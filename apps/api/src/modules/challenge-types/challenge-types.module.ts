import { Module } from '@nestjs/common';
import { ChallengeTypesController } from './challenge-types.controller';
import { ChallengeTypesService } from './challenge-types.service';

@Module({
  controllers: [ChallengeTypesController],
  providers: [ChallengeTypesService],
})
export class ChallengeTypesModule {}
