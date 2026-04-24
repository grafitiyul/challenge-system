import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';

// Admin-only in Phase 1. All writes are manual entries performed by an
// operator from the participant profile. A future iCount webhook will
// call createFromWebhook() (not yet implemented) with rawPayload set.

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForParticipant(participantId: string) {
    await this.requireParticipant(participantId);
    return this.prisma.payment.findMany({
      where: { participantId },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createForParticipant(participantId: string, dto: CreatePaymentDto) {
    await this.requireParticipant(participantId);
    return this.prisma.payment.create({
      data: {
        participant: { connect: { id: participantId } },
        provider: dto.provider ?? 'manual',
        externalPaymentId: dto.externalPaymentId ?? null,
        amount: new Prisma.Decimal(dto.amount),
        currency: dto.currency?.trim() || 'ILS',
        paidAt: new Date(dto.paidAt),
        status: dto.status ?? 'paid',
        itemName: dto.itemName.trim(),
        invoiceNumber: dto.invoiceNumber ?? null,
        invoiceUrl: dto.invoiceUrl ?? null,
        notes: dto.notes ?? null,
      },
    });
  }

  async update(id: string, dto: UpdatePaymentDto) {
    await this.requirePayment(id);
    const data: Prisma.PaymentUpdateInput = {};
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.externalPaymentId !== undefined) data.externalPaymentId = dto.externalPaymentId;
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.currency !== undefined) data.currency = dto.currency?.trim() || 'ILS';
    if (dto.paidAt !== undefined) data.paidAt = new Date(dto.paidAt);
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.itemName !== undefined) data.itemName = dto.itemName.trim();
    if (dto.invoiceNumber !== undefined) data.invoiceNumber = dto.invoiceNumber;
    if (dto.invoiceUrl !== undefined) data.invoiceUrl = dto.invoiceUrl;
    if (dto.notes !== undefined) data.notes = dto.notes;
    return this.prisma.payment.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.requirePayment(id);
    return this.prisma.payment.delete({ where: { id } });
  }

  private async requireParticipant(id: string) {
    const p = await this.prisma.participant.findUnique({ where: { id }, select: { id: true } });
    if (!p) throw new NotFoundException(`Participant ${id} not found`);
  }

  private async requirePayment(id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id }, select: { id: true } });
    if (!p) throw new NotFoundException(`Payment ${id} not found`);
  }
}
