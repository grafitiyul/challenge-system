import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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

  // POST /api/admin/whatsapp/restart-socket
  // Force the bridge to tear down its current Baileys socket and start
  // a new one without wiping creds. Used when the connection appears
  // healthy but sends hang (zombie ws). Returns 202 with
  // { ok, restart_started, readiness } from the bridge.
  @Post('restart-socket')
  restartSocket() {
    return this.svc.restartSocket();
  }

  // POST /api/admin/whatsapp/send  { phone | chatId, message }
  //
  // Replaces the legacy /api/wassenger/send endpoint that the admin
  // group page was calling for group-chat sends. Same payload shape
  // (phone or group JID, message) so the frontend swap is one URL
  // change. Single-recipient only — the WhatsappBridgeService refuses
  // anything that looks like a bulk request via the bridge's narrow
  // /send contract.
  @Post('send')
  send(@Body() body: { phone?: string; message?: string }) {
    if (!body?.phone || !body?.message) {
      throw new BadRequestException('מספר טלפון והודעה הם שדות חובה');
    }
    return this.svc.sendMessage(body.phone, body.message);
  }
}
