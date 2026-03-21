import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { CreateGroupChatLinkDto } from './dto/create-group-chat-link.dto';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  findAll(@Query('challengeId') challengeId?: string) {
    return this.groupsService.findAll(challengeId);
  }

  @Post()
  create(@Body() dto: CreateGroupDto) {
    return this.groupsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.groupsService.findById(id);
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
}
