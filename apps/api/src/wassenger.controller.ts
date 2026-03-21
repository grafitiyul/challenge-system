import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { WassengerService } from './wassenger.service';

@Controller('wassenger')
export class WassengerController {
  constructor(private readonly wassengerService: WassengerService) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(@Body() body: Record<string, unknown>): Promise<{ ok: boolean }> {
    try {
      await this.wassengerService.saveEvent(body);
    } catch (err) {
      // Never return a non-200 to Wassenger — it would keep retrying
      console.error('[Wassenger] failed to save event:', err);
    }
    return { ok: true };
  }

  @Get('events')
  async getEvents() {
    return this.wassengerService.getLatestEvents(50);
  }
}
