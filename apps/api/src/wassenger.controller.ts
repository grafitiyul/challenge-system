import { Body, Controller, DefaultValuePipe, Get, HttpCode, HttpException, HttpStatus, Param, ParseIntPipe, Post, Query, BadRequestException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { WassengerService } from './wassenger.service';

@Controller('wassenger')
export class WassengerController {
  constructor(private readonly wassengerService: WassengerService) {}

  // ── Webhook receiver ──────────────────────────────────────────────────────
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

  // ── Historical backfill ───────────────────────────────────────────────────
  // POST /api/wassenger/backfill?days=30
  // Requires WASSENGER_API_KEY env var to be set.
  // Safe to run multiple times — messages are deduplicated by externalMessageId.
  @Post('backfill')
  async runBackfill(
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
  ) {
    if (days < 1 || days > 365) {
      throw new HttpException('days must be between 1 and 365', HttpStatus.BAD_REQUEST);
    }
    try {
      const result = await this.wassengerService.runBackfill(days);
      return { ok: true, stats: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Backfill failed';
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // ── Send message ─────────────────────────────────────────────────────────
  // POST /api/wassenger/send  { phone: "972...", message: "..." }
  @Post('send')
  async sendMessage(@Body() body: { phone?: string; message?: string }) {
    if (!body.phone || !body.message) {
      throw new BadRequestException('phone and message are required');
    }
    try {
      await this.wassengerService.sendMessage(body.phone, body.message);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send';
      throw new HttpException(msg, HttpStatus.BAD_GATEWAY);
    }
  }

  // ── Chat list ─────────────────────────────────────────────────────────────
  @Get('chats')
  getChats() {
    return this.wassengerService.getChats();
  }

  // ── Single chat with all messages ─────────────────────────────────────────
  @Get('chats/:id')
  getChatWithMessages(@Param('id') id: string) {
    return this.wassengerService.getChatWithMessages(id);
  }

  // ── Raw events (debug / audit) ────────────────────────────────────────────
  @Get('events')
  getEvents() {
    return this.wassengerService.getLatestEvents(50);
  }
}
