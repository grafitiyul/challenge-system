import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { ProgramsService } from './programs.service';
import { CreateProgramDto } from './dto/create-program.dto';
import { UpdateProgramDto } from './dto/update-program.dto';
import { CreateProgramGroupDto } from './dto/create-program-group.dto';
import { CreateMessageTemplateDto, UpdateMessageTemplateDto } from './dto/create-message-template.dto';
import { ProgramType } from '@prisma/client';

@UseGuards(AdminSessionGuard)
@Controller('programs')
export class ProgramsController {
  constructor(private readonly svc: ProgramsService) {}

  @Get()
  listAll(@Query('type') type?: ProgramType) {
    return this.svc.listAll(type);
  }

  @Post()
  create(@Body() dto: CreateProgramDto) {
    return this.svc.create(dto);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.svc.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProgramDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.svc.deactivate(id);
  }

  @Post(':id/groups')
  createGroup(@Param('id') id: string, @Body() dto: CreateProgramGroupDto) {
    return this.svc.createGroup(id, dto);
  }

  // ── Message templates ──────────────────────────────────────────────────────

  @Get(':id/templates')
  listTemplates(@Param('id') id: string) {
    return this.svc.listTemplates(id);
  }

  @Post(':id/templates')
  createTemplate(@Param('id') id: string, @Body() dto: CreateMessageTemplateDto) {
    return this.svc.createTemplate(id, dto);
  }

  @Patch(':id/templates/:templateId')
  updateTemplate(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @Body() dto: UpdateMessageTemplateDto,
  ) {
    return this.svc.updateTemplate(id, templateId, dto);
  }

  @Delete(':id/templates/:templateId')
  deleteTemplate(@Param('id') id: string, @Param('templateId') templateId: string) {
    return this.svc.deleteTemplate(id, templateId);
  }

  // ── Phase 4: product-shaped surfaces (Program = Product) ─────────────────

  @Get(':id/waitlist')
  listWaitlist(@Param('id') id: string) {
    return this.svc.listWaitlist(id);
  }

  @Post(':id/waitlist')
  addWaitlist(
    @Param('id') id: string,
    @Body() body: { participantId: string; source?: string | null; notes?: string | null },
  ) {
    return this.svc.addWaitlist(id, body);
  }

  @Delete(':id/waitlist/:participantId')
  removeWaitlist(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
  ) {
    return this.svc.removeWaitlist(id, participantId);
  }

  @Get(':id/offers')
  listOffers(@Param('id') id: string) {
    return this.svc.listOffers(id);
  }

  @Get(':id/communication-templates')
  listCommunicationTemplates(
    @Param('id') id: string,
    @Query('channel') channel?: string,
  ) {
    return this.svc.listCommunicationTemplates(id, channel);
  }

  @Post(':id/communication-templates')
  createCommunicationTemplate(
    @Param('id') id: string,
    @Body() body: { channel: 'email' | 'whatsapp'; title: string; subject?: string | null; body: string; isActive?: boolean },
  ) {
    return this.svc.createCommunicationTemplate(id, body);
  }

  @Get(':id/groups')
  listRelatedGroups(@Param('id') id: string) {
    return this.svc.listRelatedGroups(id);
  }
}

// Standalone CRUD endpoints for individual communication templates.
// Mirrors the pre-Phase-4 shape so the template editor can PATCH/DELETE
// without knowing the program id.
@UseGuards(AdminSessionGuard)
@Controller('communication-templates')
export class CommunicationTemplatesController {
  constructor(private readonly svc: ProgramsService) {}

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { channel?: 'email' | 'whatsapp'; title?: string; subject?: string | null; body?: string; isActive?: boolean },
  ) {
    return this.svc.updateCommunicationTemplate(id, body);
  }

  @Delete(':id')
  deactivate(@Param('id') id: string) {
    return this.svc.deactivateCommunicationTemplate(id);
  }
}
