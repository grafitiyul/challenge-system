import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { SettingsService } from './settings.service';

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
