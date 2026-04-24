import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';

// Admin-only. Phase 1 surface is a single nested resource under the
// participant, since every real-world operation ("add her payment",
// "fix the amount") happens in the context of a specific participant.

@UseGuards(AdminSessionGuard)
@Controller()
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Get('participants/:participantId/payments')
  list(@Param('participantId') participantId: string) {
    return this.svc.listForParticipant(participantId);
  }

  @Post('participants/:participantId/payments')
  create(
    @Param('participantId') participantId: string,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.svc.createForParticipant(participantId, dto);
  }

  @Patch('payments/:id')
  update(@Param('id') id: string, @Body() dto: UpdatePaymentDto) {
    return this.svc.update(id, dto);
  }

  @Delete('payments/:id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  // Toggle reconciliation flag. `verified=true` stamps verifiedAt=now;
  // `verified=false` clears it.
  @Post('payments/:id/verify')
  verify(@Param('id') id: string, @Body() body: { verified: boolean }) {
    return this.svc.setVerified(id, body.verified);
  }
}
