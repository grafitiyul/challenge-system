import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { AdminSessionGuard } from '../auth/admin-session.guard';
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

class SetPermissionDto {
  @IsBoolean()
  value: boolean;
}

// Admin-only routes. All gated behind the shared AdminSessionGuard so they
// fail closed for anonymous callers (the portal uses /public/projects/... ).
@UseGuards(AdminSessionGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly svc: ProjectsService) {}

  // GET /api/projects/by-participant/:participantId
  @Get('by-participant/:participantId')
  listForParticipant(
    @Param('participantId') participantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.svc.adminListForParticipant(participantId, { from, to });
  }

  // PATCH /api/projects/participants/:participantId/permission
  // Admin toggles canManageProjects for the participant.
  @Patch('participants/:participantId/permission')
  setPermission(
    @Param('participantId') participantId: string,
    @Body() dto: SetPermissionDto,
  ) {
    return this.svc.setManagePermission(participantId, dto.value);
  }

  // POST /api/projects/participants/:participantId
  @Post('participants/:participantId')
  create(
    @Param('participantId') participantId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.svc.adminCreateProject(participantId, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.svc.adminUpdateProject(id, dto);
  }

  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: CreateItemDto) {
    return this.svc.adminCreateItem(id, dto);
  }

  @Patch('items/:itemId')
  updateItem(@Param('itemId') itemId: string, @Body() dto: UpdateItemDto) {
    return this.svc.adminUpdateItem(itemId, dto);
  }

  @Delete('items/:itemId')
  archiveItem(@Param('itemId') itemId: string) {
    return this.svc.adminArchiveItem(itemId);
  }

  @Post(':id/items/reorder')
  reorderItems(@Param('id') id: string, @Body() dto: ReorderItemsDto) {
    return this.svc.adminReorderItems(id, dto.items);
  }

  // Admin logs are tagged to the admin's chosen participant (= the project
  // owner). We always reuse the project's participantId on write.
  // POST /api/projects/items/:itemId/logs?participantId=
  @Post('items/:itemId/logs')
  upsertLog(
    @Param('itemId') itemId: string,
    @Query('participantId') participantId: string,
    @Body() dto: UpsertLogDto,
  ) {
    return this.svc.adminUpsertLog(itemId, participantId, dto);
  }

  // POST /api/projects/:id/notes?participantId=
  @Post(':id/notes')
  addNote(
    @Param('id') id: string,
    @Query('participantId') participantId: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.svc.adminCreateNote(id, participantId, dto);
  }
}
