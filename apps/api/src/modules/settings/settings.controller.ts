import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { SettingsService } from './settings.service';

@UseGuards(AdminSessionGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // GET /api/settings → { mockParticipantsEnabled: "false", ... }
  @Get()
  findAll() {
    return this.settingsService.findAll();
  }

  // PATCH /api/settings/:key  body: { value: "true" }
  @Patch(':key')
  set(@Param('key') key: string, @Body('value') value: string) {
    return this.settingsService.set(key, value);
  }
}
