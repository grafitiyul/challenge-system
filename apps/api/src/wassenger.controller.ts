import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { WassengerService } from './wassenger.service';

@Controller('wassenger')
export class WassengerController {
  constructor(private readonly wassengerService: WassengerService) {}

  // ── Webhook receiver ──────────────────────────────────────────
  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: boolean }> {
    try {
      await this.wassengerService.ingestWebhook(body);
    } catch (err) {
      // Always return 200 — Wassenger retries on any non-2xx
      console.error('[Wassenger] ingestion error:', err);
    }
    return { ok: true };
  }

  // ── Chat list ─────────────────────────────────────────────────
  @Get('chats')
  getChats() {
    return this.wassengerService.getChats();
  }

  // ── Single chat with all messages ─────────────────────────────
  @Get('chats/:id')
  getChatWithMessages(@Param('id') id: string) {
    return this.wassengerService.getChatWithMessages(id);
  }

  // ── Raw events (debug / audit) ────────────────────────────────
  @Get('events')
  getEvents() {
    return this.wassengerService.getLatestEvents(50);
  }
}
