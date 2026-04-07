import { Module } from '@nestjs/common';
import { QuestionnairesController, SubmissionsController } from './questionnaires.controller';
import { PublicQuestionnairesController } from './public-questionnaires.controller';
import { QuestionnairesService } from './questionnaires.service';

@Module({
  controllers: [
    QuestionnairesController,
    SubmissionsController,
    PublicQuestionnairesController,
  ],
  providers: [QuestionnairesService],
  exports: [QuestionnairesService],
})
export class QuestionnairesModule {}
