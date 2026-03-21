import { Body, Controller, HttpCode, Post } from '@nestjs/common';

@Controller('wassenger')
export class WassengerController {
  @Post()
  @HttpCode(200)
  handleWebhook(@Body() body: unknown): void {
    console.log('[Wassenger] webhook received:', JSON.stringify(body, null, 2));
  }
}
