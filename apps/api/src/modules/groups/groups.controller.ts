import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { CreateGroupChatLinkDto } from './dto/create-group-chat-link.dto';

@UseGuards(AdminSessionGuard)
@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  findAll(
    @Query('challengeId') challengeId?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('includeHidden') includeHidden?: string,
  ) {
    return this.groupsService.findAll(
      challengeId,
      includeArchived === 'true',
      includeHidden === 'true',
    );
  }

  @Post()
  create(@Body() dto: CreateGroupDto) {
    return this.groupsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.groupsService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groupsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.groupsService.softDelete(id);
  }

  // Hard delete — blocked when any participant / payment / history exists.
  // Response is 400 with a human-readable blocking reason on failure.
  @Delete(':id/hard')
  hardDelete(@Param('id') id: string) {
    return this.groupsService.hardDelete(id);
  }

  // ── Questionnaires ──────────────────────────────────────────────────────────

  @Get(':id/questionnaires')
  listQuestionnaires(@Param('id') id: string) {
    return this.groupsService.listQuestionnaires(id);
  }

  // ── Participant management ──────────────────────────────────────────────────

  @Post(':id/participants')
  addParticipant(
    @Param('id') id: string,
    @Body() body: { participantId: string },
  ) {
    return this.groupsService.addParticipant(id, body.participantId);
  }

  // Bulk move N participants INTO this group. When fromGroupId is set,
  // they are also marked inactive in the source group. Tokens remain
  // stable. Returns a per-participant result list so the caller can
  // surface partial failures.
  @Post(':id/participants/bulk-move')
  bulkMove(
    @Param('id') id: string,
    @Body() body: { participantIds: string[]; fromGroupId?: string },
  ) {
    return this.groupsService.bulkMove(id, body.participantIds ?? [], body.fromGroupId);
  }

  // ── Chat links ──────────────────────────────────────────────────────────────

  @Get(':id/chat-links')
  listChatLinks(@Param('id') id: string) {
    return this.groupsService.listChatLinks(id);
  }

  @Post(':id/chat-links')
  createChatLink(@Param('id') id: string, @Body() dto: CreateGroupChatLinkDto) {
    return this.groupsService.createChatLink(id, dto);
  }

  @Delete(':id/chat-links/:linkId')
  @HttpCode(204)
  deleteChatLink(@Param('linkId') linkId: string) {
    return this.groupsService.deleteChatLink(linkId);
  }

  // ── Participant removal ─────────────────────────────────────────────────────

  @Delete(':id/participants/:participantId')
  @HttpCode(204)
  removeParticipant(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
  ) {
    return this.groupsService.removeParticipant(id, participantId);
  }
}
