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

  // POST /api/admin/whatsapp/debug-send  { phone, message? }
  // Diagnostic: exercises each step of the send pipeline
  // independently and returns per-step timings + status. Different
  // from /send: bypasses the sendChain lock, never triggers
  // markStaleAndReconnect on timeout, never persists an outbound
  // row. Use to pinpoint exactly which step (normalize / readiness /
  // onWhatsApp / sendMessage) is the source of the timeout the
  // user is seeing. Always returns 200 — the diagnostic shape is
  // in the body.
  @Post('debug-send')
  debugSend(@Body() body: { phone?: string; message?: string }) {
    if (!body?.phone) {
      throw new BadRequestException('מספר טלפון הוא שדה חובה');
    }
    return this.svc.debugSend(body.phone, body.message);
  }

  // POST /api/admin/whatsapp/hard-reset-session
  // Nuke + repair: deletes every row in whatsapp_sessions (creds +
  // signal keys), resets the WhatsAppConnection singleton, and spawns
  // a fresh Baileys socket so a new QR appears for re-pairing.
  // Different from sign-out (which calls socket.logout() and hangs on
  // broken sessions) and restart-socket (which keeps the auth state).
  // Used when restart-socket has not recovered the bridge from
  // repeated send_timeout / decrypt failures — strong signal that the
  // persisted session is corrupt.
  @Post('hard-reset-session')
  hardResetSession() {
    return this.svc.hardResetSession();
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
