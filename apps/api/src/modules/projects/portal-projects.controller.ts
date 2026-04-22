import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import {
  CreateItemDto,
  CreateNoteDto,
  CreateProjectDto,
  ReorderItemsDto,
  UpdateItemDto,
  UpdateProjectDto,
  UpsertLogDto,
} from './dto/projects.dto';

// Portal routes are unguarded — the participant's portal access token is the
// credential. Every handler calls into the service, which resolves the token
// to a participant and enforces ownership + canManageProjects for structural
// mutations.
@Controller('public/projects')
export class PortalProjectsController {
  constructor(private readonly svc: ProjectsService) {}

  // GET /api/public/projects/:token
  @Get(':token')
  bootstrap(@Param('token') token: string) {
    return this.svc.portalBootstrap(token);
  }

  // POST /api/public/projects/:token/projects
  @Post(':token/projects')
  createProject(@Param('token') token: string, @Body() dto: CreateProjectDto) {
    return this.svc.portalCreateProject(token, dto);
  }

  @Patch(':token/projects/:projectId')
  updateProject(
    @Param('token') token: string,
    @Param('projectId') projectId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.svc.portalUpdateProject(token, projectId, dto);
  }

  @Post(':token/projects/:projectId/items')
  addItem(
    @Param('token') token: string,
    @Param('projectId') projectId: string,
    @Body() dto: CreateItemDto,
  ) {
    return this.svc.portalCreateItem(token, projectId, dto);
  }

  @Patch(':token/items/:itemId')
  updateItem(
    @Param('token') token: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.svc.portalUpdateItem(token, itemId, dto);
  }

  @Delete(':token/items/:itemId')
  archiveItem(
    @Param('token') token: string,
    @Param('itemId') itemId: string,
  ) {
    return this.svc.portalArchiveItem(token, itemId);
  }

  @Post(':token/projects/:projectId/items/reorder')
  reorder(
    @Param('token') token: string,
    @Param('projectId') projectId: string,
    @Body() dto: ReorderItemsDto,
  ) {
    return this.svc.portalReorderItems(token, projectId, dto.items);
  }

  // POST /api/public/projects/:token/items/:itemId/logs
  @Post(':token/items/:itemId/logs')
  upsertLog(
    @Param('token') token: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpsertLogDto,
  ) {
    return this.svc.portalUpsertLog(token, itemId, dto);
  }

  @Post(':token/projects/:projectId/notes')
  addNote(
    @Param('token') token: string,
    @Param('projectId') projectId: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.svc.portalCreateNote(token, projectId, dto);
  }
}
