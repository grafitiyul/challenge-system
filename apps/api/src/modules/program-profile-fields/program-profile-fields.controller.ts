import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { ProgramProfileFieldsService } from './program-profile-fields.service';
import { UpsertProfileFieldDto } from './dto/upsert-field.dto';
import { ReorderFieldsDto } from './dto/reorder-fields.dto';

// Admin-only endpoints to configure a Program's "פרטים אישיים" tab.
// Participant portal endpoints will be added in a follow-up commit and
// will use a token-based guard (NOT this admin guard).

@UseGuards(AdminSessionGuard)
@Controller('programs/:programId/profile-fields')
export class ProgramProfileFieldsController {
  constructor(private readonly svc: ProgramProfileFieldsService) {}

  @Get()
  list(
    @Param('programId') programId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.svc.list(programId, { includeInactive: includeInactive === 'true' });
  }

  @Post()
  create(@Param('programId') programId: string, @Body() dto: UpsertProfileFieldDto) {
    return this.svc.create(programId, dto);
  }

  @Patch('reorder')
  reorder(@Param('programId') programId: string, @Body() dto: ReorderFieldsDto) {
    return this.svc.reorder(programId, dto);
  }

  @Post('preset/game-changer')
  applyGameChangerPreset(@Param('programId') programId: string) {
    return this.svc.applyGameChangerPreset(programId);
  }

  @Patch(':id')
  update(
    @Param('programId') programId: string,
    @Param('id') id: string,
    @Body() dto: UpsertProfileFieldDto,
  ) {
    return this.svc.update(programId, id, dto);
  }

  // Soft delete — sets isActive=false. Hard delete is intentionally not
  // exposed: existing ParticipantProfileValue rows reference the field
  // by key, and a hard delete would orphan them silently.
  @Delete(':id')
  deactivate(@Param('programId') programId: string, @Param('id') id: string) {
    return this.svc.deactivate(programId, id);
  }
}
