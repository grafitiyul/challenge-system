import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { PortalProjectsController } from './portal-projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectTaskSyncService } from './project-task-sync.service';

@Module({
  controllers: [ProjectsController, PortalProjectsController],
  providers: [ProjectsService, ProjectTaskSyncService],
  exports: [ProjectsService, ProjectTaskSyncService],
})
export class ProjectsModule {}
