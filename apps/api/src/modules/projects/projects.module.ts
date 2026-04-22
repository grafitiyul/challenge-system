import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { PortalProjectsController } from './portal-projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController, PortalProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
