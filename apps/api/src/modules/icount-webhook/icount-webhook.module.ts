import { Module } from '@nestjs/common';
import {
  IcountPublicWebhookController,
  IcountWebhookAdminController,
} from './icount-webhook.controller';
import { IcountWebhookService } from './icount-webhook.service';

@Module({
  controllers: [IcountPublicWebhookController, IcountWebhookAdminController],
  providers: [IcountWebhookService],
  exports: [IcountWebhookService],
})
export class IcountWebhookModule {}
