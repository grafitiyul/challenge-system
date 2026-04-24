import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AddWaitlistEntryDto,
  CreateCommunicationTemplateDto,
  CreateProductDto,
  UpdateCommunicationTemplateDto,
  UpdateProductDto,
} from './dto/product.dto';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Product CRUD ──────────────────────────────────────────────────────────

  findAll(opts: { activeOnly?: boolean } = {}) {
    return this.prisma.product.findMany({
      where: opts.activeOnly ? { isActive: true } : {},
      include: {
        _count: {
          select: {
            offers: true,
            questionnaireTemplates: true,
            communicationTemplates: true,
            waitlistEntries: { where: { isActive: true } },
          },
        },
      },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        offers: {
          where: { isActive: true },
          include: {
            defaultGroup: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        questionnaireTemplates: {
          where: { isActive: true },
          select: {
            id: true, internalName: true, publicTitle: true,
            submissionPurpose: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        communicationTemplates: {
          where: { isActive: true },
          orderBy: [{ channel: 'asc' }, { createdAt: 'desc' }],
        },
      },
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  create(dto: CreateProductDto) {
    return this.prisma.product.create({
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        kind: dto.kind ?? 'game',
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.requireProduct(id);
    return this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deactivate(id: string) {
    await this.requireProduct(id);
    return this.prisma.product.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // Collect every Group referenced by this product: via offer.defaultGroup
  // and via questionnaireTemplate.linkedGroup. Dedup by id. Includes
  // archived groups so admin can restore them here. Each row carries
  // "reason" labels so the admin understands why the group is listed.
  async listRelatedGroups(productId: string) {
    await this.requireProduct(productId);

    const [offers, templates] = await Promise.all([
      this.prisma.paymentOffer.findMany({
        where: { productId },
        select: {
          id: true, title: true, isActive: true,
          defaultGroup: {
            include: {
              challenge: { select: { id: true, name: true } },
              _count: { select: { participantGroups: { where: { isActive: true } } } },
            },
          },
        },
      }),
      this.prisma.questionnaireTemplate.findMany({
        where: { productId },
        select: {
          id: true, internalName: true,
          linkedGroup: {
            include: {
              challenge: { select: { id: true, name: true } },
              _count: { select: { participantGroups: { where: { isActive: true } } } },
            },
          },
        },
      }),
    ]);

    type GroupRow = (typeof offers)[number]['defaultGroup'];
    type NonNullGroup = NonNullable<GroupRow>;
    const byId = new Map<string, { group: NonNullGroup; reasons: string[] }>();

    for (const o of offers) {
      if (!o.defaultGroup) continue;
      const entry = byId.get(o.defaultGroup.id) ?? { group: o.defaultGroup, reasons: [] };
      entry.reasons.push(`הצעה: ${o.title}`);
      byId.set(o.defaultGroup.id, entry);
    }
    for (const t of templates) {
      if (!t.linkedGroup) continue;
      const entry = byId.get(t.linkedGroup.id) ?? { group: t.linkedGroup, reasons: [] };
      entry.reasons.push(`שאלון: ${t.internalName}`);
      byId.set(t.linkedGroup.id, entry);
    }

    return Array.from(byId.values()).map(({ group, reasons }) => ({
      id: group.id,
      name: group.name,
      isActive: group.isActive,
      challenge: group.challenge,
      activeMembers: group._count.participantGroups,
      reasons,
    }));
  }

  // ── Waitlist ──────────────────────────────────────────────────────────────

  async listWaitlist(productId: string) {
    await this.requireProduct(productId);
    return this.prisma.productWaitlistEntry.findMany({
      where: { productId, isActive: true },
      include: {
        participant: {
          select: { id: true, firstName: true, lastName: true, phoneNumber: true, email: true, status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addWaitlist(productId: string, dto: AddWaitlistEntryDto) {
    await this.requireProduct(productId);
    return this.prisma.productWaitlistEntry.upsert({
      where: {
        productId_participantId: { productId, participantId: dto.participantId },
      },
      create: {
        productId,
        participantId: dto.participantId,
        source: dto.source ?? null,
        notes: dto.notes ?? null,
      },
      update: {
        isActive: true,
        ...(dto.source !== undefined ? { source: dto.source ?? null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes ?? null } : {}),
      },
    });
  }

  async removeWaitlist(productId: string, participantId: string) {
    // Soft-delete: keep the row for history.
    await this.requireProduct(productId);
    return this.prisma.productWaitlistEntry.update({
      where: { productId_participantId: { productId, participantId } },
      data: { isActive: false },
    });
  }

  // ── Communication templates ───────────────────────────────────────────────

  async listTemplates(productId: string, channel?: string) {
    await this.requireProduct(productId);
    return this.prisma.communicationTemplate.findMany({
      where: {
        productId,
        isActive: true,
        ...(channel ? { channel } : {}),
      },
      orderBy: [{ channel: 'asc' }, { title: 'asc' }],
    });
  }

  async createTemplate(productId: string, dto: CreateCommunicationTemplateDto) {
    await this.requireProduct(productId);
    return this.prisma.communicationTemplate.create({
      data: {
        productId,
        channel: dto.channel,
        title: dto.title.trim(),
        // Subject only makes sense for email — null it out for whatsapp.
        subject: dto.channel === 'email' ? (dto.subject ?? null) : null,
        body: dto.body,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateTemplate(id: string, dto: UpdateCommunicationTemplateDto) {
    const existing = await this.prisma.communicationTemplate.findUnique({
      where: { id },
      select: { id: true, channel: true },
    });
    if (!existing) throw new NotFoundException(`Template ${id} not found`);
    const finalChannel = dto.channel ?? existing.channel;
    return this.prisma.communicationTemplate.update({
      where: { id },
      data: {
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.subject !== undefined
          ? { subject: finalChannel === 'email' ? (dto.subject ?? null) : null }
          : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async deactivateTemplate(id: string) {
    const existing = await this.prisma.communicationTemplate.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException(`Template ${id} not found`);
    return this.prisma.communicationTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }

  private async requireProduct(id: string) {
    const p = await this.prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!p) throw new NotFoundException(`Product ${id} not found`);
  }
}
