import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { ScheduledMessageTemplatesService } from './templates.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';

// Program-level scheduled-message templates. These are DEFAULTS only
// — never sent by themselves. Groups clone these into
// GroupScheduledMessage rows that the cron worker actually executes.

@UseGuards(AdminSessionGuard)
@Controller('programs/:programId/scheduled-templates')
export class ScheduledMessageTemplatesController {
  constructor(private readonly svc: ScheduledMessageTemplatesService) {}

  @Get()
  list(@Param('programId') programId: string) {
    return this.svc.list(programId);
  }

  @Post()
  create(@Param('programId') programId: string, @Body() dto: CreateTemplateDto) {
    return this.svc.create(programId, dto);
  }

  @Patch(':templateId')
  update(
    @Param('programId') programId: string,
    @Param('templateId') templateId: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.svc.update(programId, templateId, dto);
  }

  // Soft-delete (sets isActive=false). Group rows already cloned from
  // this template stay intact via the schema's ON DELETE SET NULL.
  @Delete(':templateId')
  deactivate(
    @Param('programId') programId: string,
    @Param('templateId') templateId: string,
  ) {
    return this.svc.deactivate(programId, templateId);
  }

  @Post('reorder')
  reorder(
    @Param('programId') programId: string,
    @Body() body: { items: { id: string; sortOrder: number }[] },
  ) {
    return this.svc.reorder(programId, body.items);
  }
}
