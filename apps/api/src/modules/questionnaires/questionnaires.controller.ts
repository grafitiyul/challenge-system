import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { QuestionnairesService } from './questionnaires.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { CreateOptionDto } from './dto/create-option.dto';
import { CreateExternalLinkDto } from './dto/create-external-link.dto';
import { UpdateExternalLinkDto } from './dto/update-external-link.dto';
import { CreateSubmissionDto } from './dto/create-submission.dto';

@Controller('questionnaires')
export class QuestionnairesController {
  constructor(private readonly svc: QuestionnairesService) {}

  // ── Templates ────────────────────────────────────────────────────────────────

  @Get()
  listTemplates() {
    return this.svc.listTemplates();
  }

  @Post()
  createTemplate(@Body() dto: CreateTemplateDto) {
    return this.svc.createTemplate(dto);
  }

  @Get(':id')
  getTemplate(@Param('id') id: string) {
    return this.svc.getTemplate(id);
  }

  @Patch(':id')
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.svc.updateTemplate(id, dto);
  }

  @Delete(':id')
  deleteTemplate(@Param('id') id: string) {
    return this.svc.deleteTemplate(id);
  }

  // ── Questions ────────────────────────────────────────────────────────────────

  // Must be declared before :id/questions/:qid to avoid NestJS treating "reorder" as :qid
  @Post(':id/questions/reorder')
  reorderQuestions(
    @Param('id') id: string,
    @Body() body: { items: { id: string; sortOrder: number }[] },
  ) {
    return this.svc.reorderQuestions(id, body.items);
  }

  @Post(':id/questions')
  addQuestion(@Param('id') id: string, @Body() dto: CreateQuestionDto) {
    return this.svc.addQuestion(id, dto);
  }

  @Patch(':id/questions/:qid')
  updateQuestion(
    @Param('id') id: string,
    @Param('qid') qid: string,
    @Body() dto: UpdateQuestionDto,
  ) {
    return this.svc.updateQuestion(id, qid, dto);
  }

  @Delete(':id/questions/:qid')
  deleteQuestion(@Param('id') id: string, @Param('qid') qid: string) {
    return this.svc.deleteQuestion(id, qid);
  }

  // ── Options ──────────────────────────────────────────────────────────────────

  @Post(':id/questions/:qid/options')
  addOption(
    @Param('id') id: string,
    @Param('qid') qid: string,
    @Body() dto: CreateOptionDto,
  ) {
    return this.svc.addOption(id, qid, dto);
  }

  @Delete(':id/questions/:qid/options/:oid')
  deleteOption(
    @Param('id') id: string,
    @Param('qid') qid: string,
    @Param('oid') oid: string,
  ) {
    return this.svc.deleteOption(id, qid, oid);
  }

  // ── External Links ───────────────────────────────────────────────────────────

  @Get(':id/links')
  listLinks(@Param('id') id: string) {
    return this.svc.listLinks(id);
  }

  @Post(':id/links')
  createLink(@Param('id') id: string, @Body() dto: CreateExternalLinkDto) {
    return this.svc.createLink(id, dto);
  }

  @Patch(':id/links/:lid')
  updateLink(
    @Param('id') id: string,
    @Param('lid') lid: string,
    @Body() dto: UpdateExternalLinkDto,
  ) {
    return this.svc.updateLink(id, lid, dto);
  }

  // ── Submissions (internal/admin) ─────────────────────────────────────────────

  @Get(':id/submissions')
  listSubmissions(@Param('id') id: string) {
    return this.svc.listSubmissions(id);
  }

  @Post(':id/submissions')
  createSubmission(@Param('id') id: string, @Body() dto: CreateSubmissionDto) {
    return this.svc.createSubmission(id, dto);
  }
}

// ── Standalone submission routes (not nested under a template) ────────────────

@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly svc: QuestionnairesService) {}

  @Get('by-participant/:participantId')
  listByParticipant(@Param('participantId') participantId: string) {
    return this.svc.listSubmissionsByParticipant(participantId);
  }

  @Get(':id')
  getSubmission(@Param('id') id: string) {
    return this.svc.getSubmission(id);
  }
}
