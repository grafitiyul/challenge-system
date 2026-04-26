import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  extractIcountFields,
  normalizeIsraeliPhone,
  splitName,
  type ExtractedFields,
} from './icount-payload';

// Shape returned after every webhook call so the public controller can
// log outcomes without leaking internals.
//
// Status meanings:
//   processed     — matched an active PaymentOffer + participant; Payment created
//   needs_review  — matched an offer but the participant could not be matched/created
//   duplicate     — saw this externalPaymentId before (iCount retry); existing payment reused
//   ignored       — payload is unrelated to any active offer (e.g. other business
//                   transactions iCount sends through the same webhook). NO participant,
//                   NO payment, NO group join, NO token. Hidden from default admin view.
//   error         — unexpected failure during ingestion
export interface IngestionOutcome {
  logId: string;
  status: 'processed' | 'needs_review' | 'duplicate' | 'ignored' | 'error';
  paymentId?: string;
  reason?: string;
}

@Injectable()
export class IcountWebhookService {
  private readonly logger = new Logger(IcountWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Public ingestion path ────────────────────────────────────────────────
  //
  // 1. Always persist a log row first — the raw JSON is the source of
  //    truth. If anything below throws, we still have it for review.
  // 2. Probe the payload for known fields and project them onto the log.
  // 3. Dedup by (provider='icount', externalPaymentId) — iCount retries.
  // 4. Try to match an offer + a participant. If either is missing, we
  //    leave the log in `needs_review` and admin attaches later.
  // 5. On full match: create Payment (verifiedAt=now), auto-join the
  //    offer's defaultGroup, ensure participant accessToken exists.

  async ingest(rawPayload: unknown): Promise<IngestionOutcome> {
    const fields = extractIcountFields(rawPayload);
    const log = await this.prisma.icountWebhookLog.create({
      data: {
        rawPayload: rawPayload as Prisma.InputJsonValue,
        status: 'needs_review',
        extDocNumber: fields.docNumber,
        extTransactionId: fields.transactionId,
        extAmount: fields.amount != null ? new Prisma.Decimal(fields.amount) : null,
        extCurrency: fields.currency,
        extCustomerName: fields.customerName,
        extCustomerPhone: fields.customerPhone,
        extCustomerEmail: fields.customerEmail,
        extPageId: fields.pageId,
        extItemName: fields.itemName,
      },
    });

    try {
      // Dedup by (provider='icount', externalPaymentId). iCount retries
      // the same webhook on transient failures, so we must never create
      // a second Payment for the same transaction. If a Payment row
      // already exists we ALSO backfill any missing fields on it — some
      // historical payments were created before automation extracted the
      // invoice URL / invoice number / offer link correctly.
      if (fields.transactionId) {
        const existing = await this.prisma.payment.findFirst({
          where: { provider: 'icount', externalPaymentId: fields.transactionId },
        });
        if (existing) {
          await this.backfillExistingPayment(existing, fields);
          await this.prisma.icountWebhookLog.update({
            where: { id: log.id },
            data: {
              status: 'duplicate',
              matchedPaymentId: existing.id,
              matchedOfferId: existing.offerId,
              matchedParticipantId: existing.participantId,
              errorMessage: null,
              processedAt: new Date(),
            },
          });
          return { logId: log.id, status: 'duplicate', paymentId: existing.id };
        }
      }

      const outcome = await this.resolveAndRecord(log.id, fields);
      return outcome;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`iCount ingest failed for log ${log.id}: ${msg}`);
      await this.prisma.icountWebhookLog.update({
        where: { id: log.id },
        data: { status: 'error', errorMessage: msg, processedAt: new Date() },
      });
      return { logId: log.id, status: 'error', reason: msg };
    }
  }

  // Core matching + creation flow. Pulled out so `reprocess()` can
  // re-run the exact same logic against a log that previously failed.
  private async resolveAndRecord(logId: string, fields: ExtractedFields): Promise<IngestionOutcome> {
    const offer = await this.matchOffer(fields);

    // Unrelated payload — no active offer matches by pageId / externalId /
    // itemName. We deliberately do NOT touch participants, payments, groups
    // or tokens. The raw log stays for audit but is hidden from default views.
    if (!offer) {
      await this.prisma.icountWebhookLog.update({
        where: { id: logId },
        data: {
          status: 'ignored',
          matchedOfferId: null,
          matchedParticipantId: null,
          errorMessage:
            'התשלום לא משויך להצעה פעילה (אין התאמה לפי iCountPageId / iCountItemName / iCountExternalId). הרשומה נשמרה לתיעוד בלבד.',
          processedAt: new Date(),
        },
      });
      return { logId, status: 'ignored', reason: 'no offer match' };
    }

    const participant = await this.matchOrCreateParticipant(fields);
    if (!participant) {
      await this.prisma.icountWebhookLog.update({
        where: { id: logId },
        data: {
          status: 'needs_review',
          matchedOfferId: offer.id,
          matchedParticipantId: null,
          errorMessage: 'נמצאה הצעה אך לא נמצאה משתתפת (חסר טלפון ואימייל, או הנתונים לא מאפשרים יצירה בטוחה).',
          processedAt: new Date(),
        },
      });
      return { logId, status: 'needs_review', reason: 'participant' };
    }

    const payment = await this.createPaymentFromLog(participant.id, offer.id, fields);
    await this.autoJoinGroup(participant.id, offer.defaultGroupId ?? null);
    await this.ensureParticipantToken(participant.id);

    await this.prisma.icountWebhookLog.update({
      where: { id: logId },
      data: {
        status: 'processed',
        matchedOfferId: offer.id,
        matchedParticipantId: participant.id,
        matchedPaymentId: payment.id,
        errorMessage: null,
        processedAt: new Date(),
      },
    });
    return { logId, status: 'processed', paymentId: payment.id };
  }

  // ── Offer matching ───────────────────────────────────────────────────────
  //
  // Strict whitelist matching: only iCountPageId, iCountExternalId, or
  // iCountItemName count as a valid match. Amount-only matching is
  // deliberately disabled — iCount sends ALL business transactions
  // through the same webhook, including unrelated ones (e.g. "Webbing",
  // "אנקורי ת״א"). Auto-creating a Payment + Participant just because
  // an unrelated invoice happened to share an amount with one of our
  // offers would pollute the CRM and assign random people to groups.

  private async matchOffer(fields: ExtractedFields) {
    if (fields.pageId) {
      const byPage = await this.prisma.paymentOffer.findFirst({
        where: { isActive: true, iCountPageId: fields.pageId },
      });
      if (byPage) return byPage;
    }
    if (fields.itemName) {
      const byExt = await this.prisma.paymentOffer.findFirst({
        where: { isActive: true, iCountExternalId: fields.itemName },
      });
      if (byExt) return byExt;
    }
    if (fields.itemName) {
      const byItem = await this.prisma.paymentOffer.findFirst({
        where: { isActive: true, iCountItemName: fields.itemName },
      });
      if (byItem) return byItem;
    }
    return null;
  }

  // ── Participant matching / creation ─────────────────────────────────────

  private async matchOrCreateParticipant(fields: ExtractedFields) {
    const phone = normalizeIsraeliPhone(fields.customerPhone);
    const email = fields.customerEmail?.toLowerCase().trim() || null;

    // Match by phone first (Israeli primary key of choice), email fallback.
    let existing = phone
      ? await this.prisma.participant.findUnique({ where: { phoneNumber: phone } })
      : null;
    if (!existing && email) {
      existing = await this.prisma.participant.findFirst({ where: { email } });
    }

    if (existing) {
      // Backfill only missing fields — never overwrite existing non-empty values.
      const { first, last } = splitName(
        fields.customerName,
        fields.customerFirstName,
        fields.customerLastName,
      );
      const patch: Prisma.ParticipantUpdateInput = {};
      if (!existing.firstName && first) patch.firstName = first;
      if (!existing.lastName && last) patch.lastName = last;
      if (!existing.email && email) patch.email = email;
      if (!existing.phoneNumber && phone) patch.phoneNumber = phone;
      if (Object.keys(patch).length) {
        await this.prisma.participant.update({ where: { id: existing.id }, data: patch });
      }
      return existing;
    }

    // Create: require at least a phone OR an email to be safe.
    if (!phone && !email) return null;
    const { first, last } = splitName(
      fields.customerName,
      fields.customerFirstName,
      fields.customerLastName,
    );
    if (!first && !fields.customerName) return null;

    // Ensure the default "לא צוין" gender (same pattern used by the
    // questionnaire flow for auto-created participants).
    let gender = await this.prisma.gender.findFirst({ where: { name: 'לא צוין' } });
    if (!gender) {
      gender = await this.prisma.gender.create({ data: { name: 'לא צוין' } });
    }

    try {
      return await this.prisma.participant.create({
        data: {
          firstName: first || fields.customerName || 'לא ידוע',
          lastName: last ?? null,
          phoneNumber: phone ?? `icount-${Date.now()}`, // phoneNumber is UNIQUE NOT NULL
          email,
          genderId: gender.id,
          source: 'payment_import',
          status: 'paid',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && phone) {
        // Unique conflict — concurrent create. Re-fetch.
        return this.prisma.participant.findUnique({ where: { phoneNumber: phone } });
      }
      throw err;
    }
  }

  // ── Payment + group helpers ─────────────────────────────────────────────

  private async createPaymentFromLog(
    participantId: string,
    offerId: string,
    fields: ExtractedFields,
  ) {
    const amount = fields.amount ?? 0;
    return this.prisma.payment.create({
      data: {
        participant: { connect: { id: participantId } },
        offer: { connect: { id: offerId } },
        provider: 'icount',
        externalPaymentId: fields.transactionId,
        amount: new Prisma.Decimal(amount),
        currency: fields.currency?.trim() || 'ILS',
        paidAt: fields.paidAt ?? new Date(),
        status: 'paid',
        verifiedAt: new Date(),
        itemName: fields.itemName ?? 'iCount payment',
        invoiceNumber: fields.docNumber,
        invoiceUrl: fields.invoiceUrl,
        rawPayload: undefined,
      },
    });
  }

  // Backfill ONLY missing fields on a pre-existing Payment row — never
  // overwrite a non-empty field. Used when we receive a duplicate
  // webhook (same externalPaymentId) for a payment that was created
  // before the extractor pulled invoice URL / number reliably, or that
  // was attached manually by an admin without those fields.
  //
  // Also re-runs the auto-join + ensure-token side effects so the
  // participant ends up in the right group with a usable token even if
  // the original creation path skipped them.
  private async backfillExistingPayment(
    existing: { id: string; participantId: string; offerId: string | null;
      invoiceNumber: string | null; invoiceUrl: string | null;
      verifiedAt: Date | null; status: string; itemName: string | null;
      paidAt: Date | null; },
    fields: ExtractedFields,
  ) {
    const patch: Prisma.PaymentUpdateInput = {};
    if (!existing.invoiceNumber && fields.docNumber) patch.invoiceNumber = fields.docNumber;
    if (!existing.invoiceUrl && fields.invoiceUrl) patch.invoiceUrl = fields.invoiceUrl;
    if (!existing.itemName && fields.itemName) patch.itemName = fields.itemName;
    if (!existing.paidAt && fields.paidAt) patch.paidAt = fields.paidAt;
    if (!existing.verifiedAt) patch.verifiedAt = new Date();
    if (existing.status !== 'paid') patch.status = 'paid';

    // If the payment row predates the offer-matching logic and is missing
    // an offer link, attach it now (only when matchOffer finds one).
    let offerForJoin: { id: string; defaultGroupId: string | null } | null = null;
    if (!existing.offerId) {
      const offer = await this.matchOffer(fields);
      if (offer) {
        patch.offer = { connect: { id: offer.id } };
        offerForJoin = { id: offer.id, defaultGroupId: offer.defaultGroupId };
      }
    } else {
      const off = await this.prisma.paymentOffer.findUnique({
        where: { id: existing.offerId },
        select: { id: true, defaultGroupId: true },
      });
      offerForJoin = off;
    }

    if (Object.keys(patch).length) {
      await this.prisma.payment.update({ where: { id: existing.id }, data: patch });
    }
    if (offerForJoin?.defaultGroupId) {
      await this.autoJoinGroup(existing.participantId, offerForJoin.defaultGroupId);
    }
    await this.ensureParticipantToken(existing.participantId);
  }

  private async autoJoinGroup(participantId: string, groupId: string | null) {
    if (!groupId) return;
    await this.prisma.participantGroup.upsert({
      where: { participantId_groupId: { participantId, groupId } },
      create: { participantId, groupId },
      update: { isActive: true, leftAt: null },
    });
  }

  private async ensureParticipantToken(participantId: string) {
    const p = await this.prisma.participant.findUnique({
      where: { id: participantId },
      select: { accessToken: true },
    });
    if (p?.accessToken) return;
    // Shared char set mirrors groups.service.randomAlphanumeric.
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let token: string;
    let attempts = 0;
    do {
      token = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const existing = await this.prisma.participant.findUnique({
        where: { accessToken: token }, select: { id: true },
      });
      if (!existing) break;
      attempts++;
    } while (attempts < 10);
    await this.prisma.participant.update({
      where: { id: participantId },
      data: { accessToken: token! },
    });
  }

  // ── Admin review surface ───────────────────────────────────────────────

  async listLogs(opts: { status?: string; take?: number } = {}) {
    // Default ("all") view hides `ignored` rows so unrelated business
    // transactions iCount sends don't drown the operator's inbox. Caller
    // can opt in by passing `status: 'ignored'`.
    const where: Prisma.IcountWebhookLogWhereInput = opts.status
      ? { status: opts.status }
      : { status: { not: 'ignored' } };
    return this.prisma.icountWebhookLog.findMany({
      where,
      include: {
        matchedOffer: { select: { id: true, title: true, amount: true, currency: true } },
        matchedParticipant: {
          select: { id: true, firstName: true, lastName: true, phoneNumber: true, email: true },
        },
        matchedPayment: { select: { id: true, itemName: true, amount: true, currency: true, paidAt: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: opts.take ?? 100,
    });
  }

  async findLog(id: string) {
    const log = await this.prisma.icountWebhookLog.findUnique({
      where: { id },
      include: {
        matchedOffer: true,
        matchedParticipant: true,
        matchedPayment: true,
      },
    });
    if (!log) throw new NotFoundException(`Log ${id} not found`);
    return log;
  }

  // Manually bind a log to a participant + offer, then run the creation
  // path. Used when automatic matching fails. Idempotent — if a Payment
  // already exists for this log we just return it.
  async attach(
    logId: string,
    dto: { participantId: string; offerId: string; notes?: string | null },
  ) {
    const log = await this.findLog(logId);
    if (log.matchedPaymentId && log.status === 'processed') {
      return this.findLog(logId);
    }
    const [p, o] = await Promise.all([
      this.prisma.participant.findUnique({ where: { id: dto.participantId }, select: { id: true } }),
      this.prisma.paymentOffer.findUnique({ where: { id: dto.offerId } }),
    ]);
    if (!p) throw new NotFoundException(`Participant ${dto.participantId} not found`);
    if (!o) throw new NotFoundException(`Offer ${dto.offerId} not found`);

    const fields: ExtractedFields = {
      docNumber: log.extDocNumber,
      transactionId: log.extTransactionId,
      amount: log.extAmount != null ? Number(log.extAmount) : Number(o.amount),
      currency: log.extCurrency ?? o.currency,
      customerName: log.extCustomerName,
      customerFirstName: null,
      customerLastName: null,
      customerPhone: log.extCustomerPhone,
      customerEmail: log.extCustomerEmail,
      pageId: log.extPageId,
      itemName: log.extItemName ?? o.title,
      invoiceUrl: null,
      paidAt: null,
    };
    const payment = await this.createPaymentFromLog(p.id, o.id, fields);
    await this.autoJoinGroup(p.id, o.defaultGroupId);
    await this.ensureParticipantToken(p.id);
    await this.prisma.icountWebhookLog.update({
      where: { id: logId },
      data: {
        status: 'processed',
        matchedOfferId: o.id,
        matchedParticipantId: p.id,
        matchedPaymentId: payment.id,
        adminNotes: dto.notes ?? log.adminNotes,
        processedAt: new Date(),
      },
    });
    return this.findLog(logId);
  }

  // Re-run automatic matching for a log that previously failed.
  async reprocess(logId: string) {
    const log = await this.findLog(logId);
    if (log.status === 'processed') return log;
    const fields = extractIcountFields(log.rawPayload);
    const outcome = await this.resolveAndRecord(log.id, fields);
    if (outcome.status === 'error') {
      throw new BadRequestException(outcome.reason ?? 'Reprocess failed');
    }
    return this.findLog(logId);
  }
}
