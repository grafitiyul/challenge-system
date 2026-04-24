import { Module } from '@nestjs/common';
import { CommunicationTemplatesController, ProgramsController } from './programs.controller';
import { ProgramsService } from './programs.service';

@Module({
  controllers: [ProgramsController, CommunicationTemplatesController],
  providers: [ProgramsService],
  exports: [ProgramsService],
})
export class ProgramsModule {}
