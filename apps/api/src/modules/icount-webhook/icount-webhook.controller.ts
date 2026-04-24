import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { IcountWebhookService } from './icount-webhook.service';

// ── Public webhook receiver ─────────────────────────────────────────────────
// URL-secret auth: iCount posts to /api/webhooks/icount/:secret where the
// secret is the ICOUNT_WEBHOOK_SECRET env var. No admin guard (iCount has
// no session cookie). We always return 200 — failure to 2xx causes the
// provider to retry and/or alert the admin, and the raw payload is
// already persisted before any processing starts.
@Controller('webhooks/icount')
export class IcountPublicWebhookController {
  private readonly logger = new Logger(IcountPublicWebhookController.name);

  constructor(private readonly svc: IcountWebhookService) {}

  @Post(':secret')
  @HttpCode(200)
  async ingest(
    @Param('secret') secret: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: boolean; status?: string; logId?: string }> {
    const expected = process.env['ICOUNT_WEBHOOK_SECRET'];
    if (!expected) {
      // Refuse silently in prod without a configured secret. Logging
      // makes it visible so the admin realises they need to set the env.
      this.logger.error('ICOUNT_WEBHOOK_SECRET not configured — webhook rejected');
      return { ok: false };
    }
    if (secret !== expected) {
      this.logger.warn('iCount webhook received with bad secret');
      return { ok: false };
    }
    try {
      const outcome = await this.svc.ingest(body);
      return { ok: true, status: outcome.status, logId: outcome.logId };
    } catch (err) {
      // Already logged + persisted inside the service; return 200 so
      // iCount doesn't retry an unrecoverable error.
      this.logger.error('iCount ingest wrapper error: ' + String(err));
      return { ok: true };
    }
  }
}

// ── Admin review surface ──────────────────────────────────────────────────
// Mounted on /api — standard admin guard applies. Lets operators see
// raw payloads, attach unmatched logs manually, and reprocess.
@UseGuards(AdminSessionGuard)
@Controller('icount-webhook/logs')
export class IcountWebhookAdminController {
  constructor(private readonly svc: IcountWebhookService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.svc.listLogs({ status });
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const log = await this.svc.findLog(id);
    if (!log) throw new NotFoundException('Log not found');
    return log;
  }

  @Post(':id/attach')
  attach(
    @Param('id') id: string,
    @Body() body: { participantId: string; offerId: string; notes?: string | null },
  ) {
    return this.svc.attach(id, body);
  }

  @Post(':id/reprocess')
  reprocess(@Param('id') id: string) {
    return this.svc.reprocess(id);
  }
}
