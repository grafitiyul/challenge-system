import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { CreateQuestionDto } from './dto/create-question.dto';
import { UpdateQuestionDto } from './dto/update-question.dto';
import { CreateOptionDto } from './dto/create-option.dto';
import { CreateExternalLinkDto } from './dto/create-external-link.dto';
import { UpdateExternalLinkDto } from './dto/update-external-link.dto';
import { CreateSubmissionDto } from './dto/create-submission.dto';

// Generates a random alphanumeric token of given length
function generateToken(length = 8): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Compute display name from firstName + optional lastName
function computeFullName(p: { firstName: string; lastName?: string | null }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ');
}

// Known internalKey values that map to participant fields
const PARTICIPANT_IDENTITY_KEYS: Record<string, 'firstName' | 'lastName' | 'phoneNumber' | 'email' | 'birthDate' | 'city'> = {
  first_name: 'firstName',
  firstName: 'firstName',
  last_name: 'lastName',
  lastName: 'lastName',
  phone: 'phoneNumber',
  phone_number: 'phoneNumber',
  phoneNumber: 'phoneNumber',
  email: 'email',
  birth_date: 'birthDate',
  birthDate: 'birthDate',
  city: 'city',
};

// Question include shape reused across queries
const QUESTION_INCLUDE = {
  options: { where: { }, orderBy: { sortOrder: 'asc' as const } },
};

const TEMPLATE_WITH_QUESTIONS = {
  questions: {
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' as const },
    include: QUESTION_INCLUDE,
  },
};

// Participant fields returned in submission includes
const PARTICIPANT_SELECT = { id: true, firstName: true, lastName: true, phoneNumber: true } as const;

@Injectable()
export class QuestionnairesService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // TEMPLATES
  // ─────────────────────────────────────────────────────────────────────────────

  async listTemplates() {
    return this.prisma.questionnaireTemplate.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { questions: { where: { isActive: true } }, submissions: true } },
      },
    });
  }

  async getTemplate(id: string) {
    const template = await this.prisma.questionnaireTemplate.findUnique({
      where: { id },
      relationLoadStrategy: 'join',
      include: TEMPLATE_WITH_QUESTIONS,
    });
    if (!template) throw new NotFoundException(`QuestionnaireTemplate ${id} not found`);
    return template;
  }

  // Lightweight existence check — does NOT fetch questions/options.
  // Use this in mutations that only need to know the template exists (or its usageType).
  private async getTemplateMeta(id: string) {
    const t = await this.prisma.questionnaireTemplate.findUnique({
      where: { id },
      select: { id: true, usageType: true, isActive: true },
    });
    if (!t) throw new NotFoundException(`QuestionnaireTemplate ${id} not found`);
    return t;
  }

  async createTemplate(dto: CreateTemplateDto) {
    return this.prisma.questionnaireTemplate.create({
      data: {
        internalName: dto.internalName,
        publicTitle: dto.publicTitle,
        introRichText: dto.introRichText ?? null,
        usageType: dto.usageType ?? 'both',
        submitBehavior: dto.submitBehavior ?? 'none',
        displayMode: dto.displayMode ?? 'step_by_step',
        postIdentificationGreeting: dto.postIdentificationGreeting ?? null,
      },
    });
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto) {
    await this.getTemplateMeta(id); // throws if not found
    return this.prisma.questionnaireTemplate.update({
      where: { id },
      data: {
        ...(dto.internalName !== undefined ? { internalName: dto.internalName } : {}),
        ...(dto.publicTitle !== undefined ? { publicTitle: dto.publicTitle } : {}),
        ...(dto.introRichText !== undefined ? { introRichText: dto.introRichText } : {}),
        ...(dto.usageType !== undefined ? { usageType: dto.usageType } : {}),
        ...(dto.submitBehavior !== undefined ? { submitBehavior: dto.submitBehavior } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.displayMode !== undefined ? { displayMode: dto.displayMode } : {}),
        ...(dto.postIdentificationGreeting !== undefined ? { postIdentificationGreeting: dto.postIdentificationGreeting || null } : {}),
      },
    });
  }

  // Soft-delete: set isActive = false; submissions remain intact
  async deleteTemplate(id: string) {
    await this.getTemplateMeta(id);
    return this.prisma.questionnaireTemplate.update({
      where: { id },
      data: { isActive: false },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // QUESTIONS
  // ─────────────────────────────────────────────────────────────────────────────

  async addQuestion(templateId: string, dto: CreateQuestionDto) {
    await this.getTemplateMeta(templateId);

    // Auto-assign sortOrder if not provided (append to end)
    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const last = await this.prisma.questionnaireQuestion.findFirst({
        where: { templateId, isActive: true },
        orderBy: { sortOrder: 'desc' },
      });
      sortOrder = last ? last.sortOrder + 10 : 10;
    }

    return this.prisma.questionnaireQuestion.create({
      data: {
        templateId,
        label: dto.label,
        internalKey: dto.internalKey,
        questionType: dto.questionType,
        helperText: dto.helperText ?? null,
        sortOrder,
        isRequired: dto.isRequired ?? false,
        allowOther: dto.allowOther ?? false,
        fieldSize: dto.fieldSize ?? null,
        isSystemField: dto.isSystemField ?? false,
      },
      include: QUESTION_INCLUDE,
    });
  }

  async updateQuestion(templateId: string, questionId: string, dto: UpdateQuestionDto) {
    const q = await this.prisma.questionnaireQuestion.findFirst({
      where: { id: questionId, templateId },
    });
    if (!q) throw new NotFoundException(`Question ${questionId} not found in template ${templateId}`);

    return this.prisma.questionnaireQuestion.update({
      where: { id: questionId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.internalKey !== undefined ? { internalKey: dto.internalKey } : {}),
        ...(dto.questionType !== undefined ? { questionType: dto.questionType } : {}),
        ...(dto.helperText !== undefined ? { helperText: dto.helperText } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.isRequired !== undefined ? { isRequired: dto.isRequired } : {}),
        ...(dto.allowOther !== undefined ? { allowOther: dto.allowOther } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: QUESTION_INCLUDE,
    });
  }

  // Soft-delete: answers still reference this question via snapshot
  async deleteQuestion(templateId: string, questionId: string) {
    return this.updateQuestion(templateId, questionId, { isActive: false });
  }

  async reorderQuestions(templateId: string, items: { id: string; sortOrder: number }[]) {
    await this.getTemplateMeta(templateId);
    await Promise.all(
      items.map((item) =>
        this.prisma.questionnaireQuestion.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        }),
      ),
    );
    return this.getTemplate(templateId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // OPTIONS
  // ─────────────────────────────────────────────────────────────────────────────

  async addOption(templateId: string, questionId: string, dto: CreateOptionDto) {
    const q = await this.prisma.questionnaireQuestion.findFirst({
      where: { id: questionId, templateId },
    });
    if (!q) throw new NotFoundException(`Question ${questionId} not found`);
    if (!['choice', 'multi'].includes(q.questionType)) {
      throw new BadRequestException(`Question type "${q.questionType}" does not support options`);
    }

    const last = await this.prisma.questionnaireQuestionOption.findFirst({
      where: { questionId },
      orderBy: { sortOrder: 'desc' },
    });
    const sortOrder = dto.sortOrder ?? (last ? last.sortOrder + 10 : 10);

    return this.prisma.questionnaireQuestionOption.create({
      data: { questionId, label: dto.label, value: dto.value, sortOrder },
    });
  }

  // Hard delete: options are leaf nodes, nothing else references them
  async deleteOption(templateId: string, questionId: string, optionId: string) {
    const opt = await this.prisma.questionnaireQuestionOption.findFirst({
      where: { id: optionId, questionId, question: { templateId } },
    });
    if (!opt) throw new NotFoundException(`Option ${optionId} not found`);
    return this.prisma.questionnaireQuestionOption.delete({ where: { id: optionId } });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // EXTERNAL LINKS
  // ─────────────────────────────────────────────────────────────────────────────

  async listLinks(templateId: string) {
    // No template validation needed — unknown templateId simply returns [] which is correct
    return this.prisma.questionnaireExternalLink.findMany({
      where: { templateId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createLink(templateId: string, dto: CreateExternalLinkDto) {
    const template = await this.getTemplateMeta(templateId);
    if (template.usageType === 'internal') {
      throw new BadRequestException('לא ניתן ליצור לינק חיצוני לשאלון פנימי בלבד');
    }

    // Generate unique token (retry up to 5 times on collision)
    let slugOrToken = '';
    for (let i = 0; i < 5; i++) {
      const candidate = generateToken(8);
      const exists = await this.prisma.questionnaireExternalLink.findUnique({
        where: { slugOrToken: candidate },
      });
      if (!exists) { slugOrToken = candidate; break; }
    }
    if (!slugOrToken) throw new BadRequestException('Could not generate unique token');

    return this.prisma.questionnaireExternalLink.create({
      data: {
        templateId,
        internalName: dto.internalName,
        slugOrToken,
        utmSource: dto.utmSource ?? null,
        utmMedium: dto.utmMedium ?? null,
        utmCampaign: dto.utmCampaign ?? null,
        utmContent: dto.utmContent ?? null,
        utmTerm: dto.utmTerm ?? null,
      },
    });
  }

  async updateLink(templateId: string, linkId: string, dto: UpdateExternalLinkDto) {
    const link = await this.prisma.questionnaireExternalLink.findFirst({
      where: { id: linkId, templateId },
    });
    if (!link) throw new NotFoundException(`Link ${linkId} not found`);
    return this.prisma.questionnaireExternalLink.update({
      where: { id: linkId },
      data: {
        ...(dto.internalName !== undefined ? { internalName: dto.internalName } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.utmSource !== undefined ? { utmSource: dto.utmSource } : {}),
        ...(dto.utmMedium !== undefined ? { utmMedium: dto.utmMedium } : {}),
        ...(dto.utmCampaign !== undefined ? { utmCampaign: dto.utmCampaign } : {}),
        ...(dto.utmContent !== undefined ? { utmContent: dto.utmContent } : {}),
        ...(dto.utmTerm !== undefined ? { utmTerm: dto.utmTerm } : {}),
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUBMISSIONS
  // ─────────────────────────────────────────────────────────────────────────────

  async listSubmissions(templateId: string) {
    return this.prisma.questionnaireSubmission.findMany({
      where: { templateId },
      relationLoadStrategy: 'join',
      include: {
        participant: { select: PARTICIPANT_SELECT },
        externalLink: { select: { internalName: true } },
        answers: {
          include: { question: { select: { label: true, questionType: true, sortOrder: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listSubmissionsByParticipant(participantId: string) {
    return this.prisma.questionnaireSubmission.findMany({
      where: { participantId },
      relationLoadStrategy: 'join',
      include: {
        template: { select: { id: true, internalName: true, publicTitle: true } },
        externalLink: { select: { internalName: true } },
        answers: {
          include: { question: { select: { label: true, questionType: true, sortOrder: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSubmission(id: string) {
    const sub = await this.prisma.questionnaireSubmission.findUnique({
      where: { id },
      relationLoadStrategy: 'join',
      include: {
        template: { select: { id: true, internalName: true, publicTitle: true } },
        participant: { select: PARTICIPANT_SELECT },
        externalLink: { select: { internalName: true, slugOrToken: true } },
        answers: {
          include: {
            question: { select: { label: true, questionType: true, sortOrder: true, internalKey: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!sub) throw new NotFoundException(`Submission ${id} not found`);
    return sub;
  }

  // Core submission creation — used by both internal and external flows
  async createSubmission(templateId: string, dto: CreateSubmissionDto) {
    const template = await this.prisma.questionnaireTemplate.findUnique({
      where: { id: templateId },
      include: {
        questions: {
          where: { isActive: true },
          include: { options: true },
        },
      },
    });
    if (!template) throw new NotFoundException(`Template ${templateId} not found`);

    // Build a lookup map: questionId → question record (for snapshot capture)
    type QuestionRecord = (typeof template.questions)[number];
    const questionMap = new Map<string, QuestionRecord>(template.questions.map((q) => [q.id, q]));

    // ── Extract participant fields from system-field answers (by internalKey) ──
    const identityFromAnswers: {
      firstName?: string;
      lastName?: string;
      phoneNumber?: string;
      email?: string;
      birthDate?: string;
      city?: string;
    } = {};

    for (const a of dto.answers) {
      const question = questionMap.get(a.questionId);
      if (!question || a.value == null) continue;
      const field = PARTICIPANT_IDENTITY_KEYS[question.internalKey];
      if (field) identityFromAnswers[field] = String(a.value).trim();
    }

    // ── Participant resolution ────────────────────────────────────────────────
    let resolvedParticipantId: string | null = dto.participantId ?? null;

    if (
      !resolvedParticipantId &&
      ['create_new_participant', 'attach_or_create'].includes(template.submitBehavior)
    ) {
      // Explicit newParticipant DTO takes priority; fall back to answers-extracted identity
      const identity = dto.newParticipant ?? (
        identityFromAnswers.phoneNumber
          ? {
              firstName: identityFromAnswers.firstName ?? 'לא ידוע',
              lastName: identityFromAnswers.lastName,
              phoneNumber: identityFromAnswers.phoneNumber,
              email: identityFromAnswers.email,
            }
          : null
      );

      if (identity) {
        // Upsert by phone number — never create a duplicate
        const existing = await this.prisma.participant.findUnique({
          where: { phoneNumber: identity.phoneNumber },
        });

        if (existing) {
          resolvedParticipantId = existing.id;
        } else {
          // Resolve or create a default gender for auto-created participants
          let gender = await this.prisma.gender.findFirst({ where: { name: 'לא צוין' } });
          if (!gender) {
            gender = await this.prisma.gender.create({ data: { name: 'לא צוין' } });
          }
          const created = await this.prisma.participant.create({
            data: {
              firstName: identity.firstName,
              lastName: identity.lastName ?? null,
              phoneNumber: identity.phoneNumber,
              email: identity.email ?? null,
              genderId: gender.id,
            },
          });
          resolvedParticipantId = created.id;
        }
      }
    }

    // ── Create submission + answers in a transaction ──────────────────────────
    const now = new Date();
    const submission = await this.prisma.questionnaireSubmission.create({
      data: {
        templateId,
        participantId: resolvedParticipantId,
        submittedByMode: dto.submittedByMode,
        externalLinkId: dto.externalLinkId ?? null,
        status: 'completed',
        submittedAt: now,
        answers: {
          create: dto.answers.map((a) => {
            const question = questionMap.get(a.questionId);
            const snapshot = question
              ? {
                  label: question.label,
                  questionType: question.questionType,
                  helperText: question.helperText ?? null,
                  internalKey: question.internalKey,
                  sortOrder: question.sortOrder,  // captured for stable ordering
                }
              : null;
            return {
              question: { connect: { id: a.questionId } },
              value: (a.value == null ? Prisma.JsonNull : a.value) as Prisma.InputJsonValue,
              questionSnapshot: snapshot == null ? Prisma.JsonNull : (snapshot as Prisma.InputJsonValue),
            };
          }),
        },
      },
      include: {
        answers: true,
        participant: { select: PARTICIPANT_SELECT },
      },
    });

    // ── Backfill participant fields from system-field answers ─────────────────
    // Update missing fields (never overwrite existing data)
    if (resolvedParticipantId) {
      const participant = await this.prisma.participant.findUnique({
        where: { id: resolvedParticipantId },
      });
      if (participant) {
        const updates: Record<string, unknown> = {};
        if (!participant.email && identityFromAnswers.email) updates.email = identityFromAnswers.email;
        if (!participant.city && identityFromAnswers.city) updates.city = identityFromAnswers.city;
        if (!participant.birthDate && identityFromAnswers.birthDate) {
          const d = new Date(identityFromAnswers.birthDate);
          if (!isNaN(d.getTime())) updates.birthDate = d;
        }
        if (Object.keys(updates).length > 0) {
          await this.prisma.participant.update({ where: { id: resolvedParticipantId }, data: updates });
        }
      }
    }

    // Add computed fullName to participant for response convenience
    return {
      ...submission,
      participant: submission.participant
        ? { ...submission.participant, fullName: computeFullName(submission.participant) }
        : null,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PUBLIC (external link resolution)
  // ─────────────────────────────────────────────────────────────────────────────

  async lookupParticipantByPhone(phone: string) {
    if (!phone) return null;
    const participant = await this.prisma.participant.findFirst({
      where: { phoneNumber: phone },
      select: { id: true, firstName: true, lastName: true, email: true, birthDate: true, city: true, phoneNumber: true },
    });
    return participant ?? null;
  }

  async resolveExternalLink(token: string) {
    const link = await this.prisma.questionnaireExternalLink.findUnique({
      where: { slugOrToken: token },
      relationLoadStrategy: 'join',
      include: {
        template: {
          include: {
            questions: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
              include: {
                options: { orderBy: { sortOrder: 'asc' } },
              },
            },
          },
        },
      },
    });

    if (!link) throw new NotFoundException('Link not found');
    if (!link.isActive) throw new BadRequestException('This link is no longer active');
    if (!link.template.isActive) throw new BadRequestException('This questionnaire is no longer active');
    if (link.template.usageType === 'internal') {
      throw new BadRequestException('לינק זה אינו זמין — השאלון הוגדר לשימוש פנימי בלבד');
    }

    return { link, template: link.template };
  }

  async submitExternal(token: string, dto: CreateSubmissionDto) {
    const { link, template } = await this.resolveExternalLink(token);

    // Merge link's UTM values into submission (link values win over anything in dto)
    const enrichedDto: CreateSubmissionDto = {
      ...dto,
      submittedByMode: 'external',
      externalLinkId: link.id,
    };

    const submission = await this.createSubmission(template.id, enrichedDto);

    // Store UTM values from link onto submission record
    await this.prisma.questionnaireSubmission.update({
      where: { id: submission.id },
      data: {
        utmSource: link.utmSource,
        utmMedium: link.utmMedium,
        utmCampaign: link.utmCampaign,
        utmContent: link.utmContent,
        utmTerm: link.utmTerm,
      },
    });

    return submission;
  }
}
