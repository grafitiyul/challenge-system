import { Global, Module } from '@nestjs/common';
import { WhatsappBridgeController } from './whatsapp-bridge.controller';
import { WhatsappBridgeService } from './whatsapp-bridge.service';

// Global so any module (Participants, Groups, future ones) can inject
// WhatsappBridgeService without re-importing this module everywhere
// that needs to send. Mirrors the pattern WassengerModule used to
// follow before its send path was retired.
@Global()
@Module({
  controllers: [WhatsappBridgeController],
  providers: [WhatsappBridgeService],
  exports: [WhatsappBridgeService],
})
export class WhatsappBridgeModule {}
