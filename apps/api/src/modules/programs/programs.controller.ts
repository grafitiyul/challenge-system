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
}
