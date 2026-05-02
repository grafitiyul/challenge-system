import { Controller, Get, Post, Patch, Delete, HttpCode, Body, Query, Param, DefaultValuePipe, ParseIntPipe, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { ParticipantsService } from './participants.service';
import { CreateParticipantDto } from './dto/create-participant.dto';
import { UpdateParticipantDto } from './dto/update-participant.dto';

@UseGuards(AdminSessionGuard)
@Controller('participants')
export class ParticipantsController {
  constructor(private readonly participantsService: ParticipantsService) {}

  @Get()
  findAll(
    @Query('groupId') groupId?: string,
    @Query('includeMock') includeMock?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    // "true" → has ≥1 payment, "false" → no payments, undefined → both.
    @Query('hasPayments') hasPayments?: string,
  ) {
    const withMock = includeMock === 'true';
    if (groupId) {
      return this.participantsService.findByGroup(groupId, withMock);
    }
    const hp = hasPayments === 'true' ? true : hasPayments === 'false' ? false : undefined;
    return this.participantsService.findAll({
      includeMock: withMock,
      status,
      source,
      hasPayments: hp,
    });
  }

  // Declared before @Get(':id') to prevent NestJS treating "mock" as an :id param
  @Post('mock')
  createMock(
    @Query('count', new DefaultValuePipe(10), ParseIntPipe) count: number,
  ) {
    console.log(`POST /participants/mock hit — count=${count}`);
    return this.participantsService.createMock(count);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.participantsService.findById(id);
  }

  // Returns active CommunicationTemplate rows (channel='whatsapp') across
  // every program this participant is currently active in. Used by the
  // unified chat composer's template picker so a single dropdown can
  // pick from any program the participant is in. Grouped by program so
  // the picker can label each option with its program name.
  @Get(':id/whatsapp-templates')
  whatsappTemplates(@Param('id') id: string) {
    return this.participantsService.listWhatsappTemplatesForParticipant(id);
  }

  @Post()
  create(@Body() dto: CreateParticipantDto) {
    return this.participantsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateParticipantDto) {
    return this.participantsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  deactivate(@Param('id') id: string) {
    return this.participantsService.deactivate(id);
  }

  @Get(':id/form-submissions')
  listFormSubmissions(@Param('id') id: string) {
    return this.participantsService.listFormSubmissions(id);
  }

  // Render a template / body against the participant's context.
  @Post(':id/messages/preview')
  previewMessage(
    @Param('id') id: string,
    @Body() body: { templateId?: string | null; rawBody?: string | null },
  ) {
    return this.participantsService.previewMessage(id, body);
  }

  // Send a WhatsApp message immediately via Wassenger.
  @Post(':id/messages/whatsapp')
  sendWhatsapp(
    @Param('id') id: string,
    @Body() body: { templateId?: string | null; rawBody?: string | null },
  ) {
    return this.participantsService.sendWhatsapp(id, body);
  }

  // POST /api/participants/:participantId/groups/:groupId/token
  // Generates (idempotent) a personal access token for the participant portal link
  @Post(':participantId/groups/:groupId/token')
  generateAccessToken(
    @Param('participantId') participantId: string,
    @Param('groupId') groupId: string,
  ) {
    return this.participantsService.generateAccessToken(participantId, groupId);
  }
}
