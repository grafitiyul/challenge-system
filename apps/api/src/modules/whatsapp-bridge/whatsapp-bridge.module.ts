import { Module } from '@nestjs/common';
import { WhatsappBridgeController } from './whatsapp-bridge.controller';
import { WhatsappBridgeService } from './whatsapp-bridge.service';

@Module({
  controllers: [WhatsappBridgeController],
  providers: [WhatsappBridgeService],
})
export class WhatsappBridgeModule {}
