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

  // Every read now joins the offer + group so the UI can render the
  // "which product / cohort does this belong to?" context without a
  // second round-trip.
  private readonly PAYMENT_INCLUDE = {
    offer: {
      select: {
        id: true,
        title: true,
        currency: true,
        iCountPaymentUrl: true,
        linkedChallenge: { select: { id: true, name: true } },
        linkedProgram: { select: { id: true, name: true } },
        defaultGroup: { select: { id: true, name: true } },
      },
    },
    group: { select: { id: true, name: true } },
  };

  async listForParticipant(participantId: string) {
    await this.requireParticipant(participantId);
    return this.prisma.payment.findMany({
      where: { participantId },
      include: this.PAYMENT_INCLUDE,
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createForParticipant(participantId: string, dto: CreatePaymentDto) {
    await this.requireParticipant(participantId);
    // Offer-driven defaults: if an offer is linked and the caller didn't
    // provide overrides, fill amount / currency / itemName from the offer.
    // That keeps the Add Payment modal fast — admin picks an offer and
    // the form pre-fills.
    let offerDefaults: { amount?: number; currency?: string; itemName?: string } = {};
    if (dto.offerId) {
      const offer = await this.prisma.paymentOffer.findUnique({
        where: { id: dto.offerId },
        select: { amount: true, currency: true, title: true, isActive: true },
      });
      if (!offer) throw new NotFoundException(`Offer ${dto.offerId} not found`);
      offerDefaults = {
        amount: Number(offer.amount),
        currency: offer.currency,
        itemName: offer.title,
      };
    }
    return this.prisma.payment.create({
      data: {
        participant: { connect: { id: participantId } },
        provider: dto.provider ?? 'manual',
        externalPaymentId: dto.externalPaymentId ?? null,
        amount: new Prisma.Decimal(dto.amount ?? offerDefaults.amount ?? 0),
        currency: dto.currency?.trim() || offerDefaults.currency || 'ILS',
        paidAt: new Date(dto.paidAt),
        status: dto.status ?? 'paid',
        itemName: (dto.itemName ?? offerDefaults.itemName ?? '').trim(),
        invoiceNumber: dto.invoiceNumber ?? null,
        invoiceUrl: dto.invoiceUrl ?? null,
        notes: dto.notes ?? null,
        ...(dto.offerId ? { offer: { connect: { id: dto.offerId } } } : {}),
        ...(dto.groupId ? { group: { connect: { id: dto.groupId } } } : {}),
      },
      include: this.PAYMENT_INCLUDE,
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
    if (dto.offerId !== undefined) {
      data.offer = dto.offerId ? { connect: { id: dto.offerId } } : { disconnect: true };
    }
    if (dto.groupId !== undefined) {
      data.group = dto.groupId ? { connect: { id: dto.groupId } } : { disconnect: true };
    }
    return this.prisma.payment.update({
      where: { id },
      data,
      include: this.PAYMENT_INCLUDE,
    });
  }

  async remove(id: string) {
    await this.requirePayment(id);
    return this.prisma.payment.delete({ where: { id } });
  }

  // Mark a payment as reconciled. Orthogonal to `status`: a row can be
  // status=paid but not yet verifiedAt (money landed, statement not yet
  // checked). Setting to null clears the flag ("unverify").
  //
  // Phase 3: when VERIFYING (not unverifying), auto-join the participant
  // into the offer's defaultGroup if set — this operationalizes the rule
  // "verified payment → cohort membership". If the payment has an explicit
  // groupId, prefer that over offer.defaultGroup. Existing Participant.
  // status is bumped to 'paid' so the lifecycle chip updates. Admin can
  // still override group membership afterwards via the group picker.
  async setVerified(id: string, verified: boolean) {
    await this.requirePayment(id);
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { verifiedAt: verified ? new Date() : null },
      include: {
        ...this.PAYMENT_INCLUDE,
        participant: { select: { id: true, status: true } },
      },
    });

    if (verified) {
      // 1. Cohort assignment: prefer payment.groupId, fall back to
      //    offer.defaultGroupId. No-op when neither is set.
      const rawOffer = updated.offer as unknown as {
        defaultGroup?: { id: string } | null;
      } | null;
      const targetGroupId = updated.groupId ?? rawOffer?.defaultGroup?.id ?? null;
      if (targetGroupId) {
        await this.prisma.participantGroup.upsert({
          where: {
            participantId_groupId: {
              participantId: updated.participantId,
              groupId: targetGroupId,
            },
          },
          create: {
            participantId: updated.participantId,
            groupId: targetGroupId,
          },
          update: { isActive: true, leftAt: null },
        });
      }
      // 2. Lifecycle bump — only if the participant is not already paid/active.
      //    Don't overwrite a stronger status like 'active'.
      const status = updated.participant?.status;
      if (status !== 'paid' && status !== 'active') {
        await this.prisma.participant.update({
          where: { id: updated.participantId },
          data: { status: 'paid' },
        });
      }
    }

    return updated;
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
