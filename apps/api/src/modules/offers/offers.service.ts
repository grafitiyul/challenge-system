import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

// Offers are the product catalog. Everything in here is admin-only.

@Injectable()
export class OffersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(opts: { activeOnly?: boolean; linkedProgramId?: string } = {}) {
    return this.prisma.paymentOffer.findMany({
      where: {
        ...(opts.activeOnly ? { isActive: true } : {}),
        ...(opts.linkedProgramId ? { linkedProgramId: opts.linkedProgramId } : {}),
      },
      include: {
        linkedChallenge: { select: { id: true, name: true } },
        linkedProgram: { select: { id: true, name: true } },
        defaultGroup: { select: { id: true, name: true } },
        _count: { select: { payments: true } },
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findById(id: string) {
    const offer = await this.prisma.paymentOffer.findUnique({
      where: { id },
      include: {
        linkedChallenge: { select: { id: true, name: true } },
        linkedProgram: { select: { id: true, name: true } },
        defaultGroup: { select: { id: true, name: true } },
        _count: { select: { payments: true } },
      },
    });
    if (!offer) throw new NotFoundException(`Offer ${id} not found`);
    return offer;
  }

  create(dto: CreateOfferDto) {
    return this.prisma.paymentOffer.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        amount: new Prisma.Decimal(dto.amount),
        currency: (dto.currency ?? 'ILS').trim() || 'ILS',
        iCountPaymentUrl: dto.iCountPaymentUrl ?? null,
        // iCount auto-match keys, used by the webhook ingester to
        // resolve incoming payments to this offer. Persisted alongside
        // the URL so a NEW offer's match keys aren't silently dropped.
        iCountPageId: dto.iCountPageId ?? null,
        iCountItemName: dto.iCountItemName ?? null,
        iCountExternalId: dto.iCountExternalId ?? null,
        linkedChallengeId: dto.linkedChallengeId ?? null,
        linkedProgramId: dto.linkedProgramId ?? null,
        defaultGroupId: dto.defaultGroupId ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateOfferDto) {
    await this.findById(id);
    const data: Prisma.PaymentOfferUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description ?? null;
    if (dto.amount !== undefined) data.amount = new Prisma.Decimal(dto.amount);
    if (dto.currency !== undefined) data.currency = dto.currency.trim() || 'ILS';
    if (dto.iCountPaymentUrl !== undefined) data.iCountPaymentUrl = dto.iCountPaymentUrl ?? null;
    // iCount auto-match keys. Sent by the admin edit modal as part of
    // the standard payload; without these fields in the writer, edits
    // that touch these inputs would silently lose them on save.
    if (dto.iCountPageId !== undefined) data.iCountPageId = dto.iCountPageId ?? null;
    if (dto.iCountItemName !== undefined) data.iCountItemName = dto.iCountItemName ?? null;
    if (dto.iCountExternalId !== undefined) data.iCountExternalId = dto.iCountExternalId ?? null;
    if (dto.linkedChallengeId !== undefined) {
      data.linkedChallenge = dto.linkedChallengeId
        ? { connect: { id: dto.linkedChallengeId } } : { disconnect: true };
    }
    if (dto.linkedProgramId !== undefined) {
      data.linkedProgram = dto.linkedProgramId
        ? { connect: { id: dto.linkedProgramId } } : { disconnect: true };
    }
    if (dto.defaultGroupId !== undefined) {
      data.defaultGroup = dto.defaultGroupId
        ? { connect: { id: dto.defaultGroupId } } : { disconnect: true };
    }
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return this.prisma.paymentOffer.update({ where: { id }, data });
  }

  // Soft delete — offers are referenced by payments, which must stay
  // readable forever. isActive=false hides the offer from the picker
  // without breaking historical reporting.
  async deactivate(id: string) {
    await this.findById(id);
    return this.prisma.paymentOffer.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
