import { Module } from '@nestjs/common';
import { TaskEngineController } from './task-engine.controller';
import { TaskEngineService } from './task-engine.service';

@Module({
  controllers: [TaskEngineController],
  providers: [TaskEngineService],
  exports: [TaskEngineService],
})
export class TaskEngineModule {}
