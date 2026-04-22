import { Module } from '@nestjs/common';
import { TaskEngineController } from './task-engine.controller';
import { TaskEngineService } from './task-engine.service';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [ProjectsModule],
  controllers: [TaskEngineController],
  providers: [TaskEngineService],
  exports: [TaskEngineService],
})
export class TaskEngineModule {}
