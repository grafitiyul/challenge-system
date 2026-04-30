import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { WhatsappBridgeService } from './whatsapp-bridge.service';

// Admin-guarded proxy to the whatsapp-bridge service. All endpoints
// require an admin session — the bridge itself sits on Railway's
// private network and rejects requests without the shared secret, so
// authentication is two-layered (admin session + service-to-service
// secret).

@UseGuards(AdminSessionGuard)
@Controller('admin/whatsapp')
export class WhatsappBridgeController {
  constructor(private readonly svc: WhatsappBridgeService) {}

  @Get('status')
  status() {
    return this.svc.getStatus();
  }

  @Post('sign-out')
  signOut() {
    return this.svc.signOut();
  }
}
