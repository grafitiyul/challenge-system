import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Admin-side full feed view. No time window, no isPublic filter — the
// whole point is to give admins visibility into hidden / superseded /
// debug events that the participant portal deliberately hides.
//
// Returns a denormalised row shape so the admin UI doesn't have to
// chase relations: participant + group + program + log basics travel
// inline. Capped at a generous 1000 rows per page to avoid runaway
// requests; the page param walks older pages via skip.

export interface AdminFeedRow {
  id: string;
  type: string;
  message: string;
  points: number;
  isPublic: boolean;
  createdAt: string;
  logId: string | null;
  participant: { id: string; firstName: string; lastName: string | null } | null;
  group: { id: string; name: string } | null;
  program: { id: string; name: string } | null;
}

export interface ListFeedOpts {
  participantId?: string;
  groupId?: string;
  programId?: string;
  // "all" (default) | "public" | "hidden" — admin-side filter for the
  // isPublic column so they can isolate the "things participants
  // actually saw" vs "things hidden by void/edit".
  visibility?: 'all' | 'public' | 'hidden';
  type?: string;
  skip?: number;
  take?: number;
}

// Generous defaults for the admin audit surface. Page size is also
// admin-selectable in the UI; MAX_TAKE only protects against a
// pathological direct API call.
const DEFAULT_TAKE = 500;
const MAX_TAKE = 2000;

export interface AdminFeedPage {
  rows: AdminFeedRow[];
  total: number;       // total rows matching the filter (no pagination)
  skip: number;        // echoed back so the UI can compute "X-Y of Z"
  take: number;        // applied page size after clamping
  hasMore: boolean;    // skip + rows.length < total
}

@Injectable()
export class AdminFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: ListFeedOpts = {}): Promise<AdminFeedPage> {
    const where: Prisma.FeedEventWhereInput = {
      ...(opts.participantId ? { participantId: opts.participantId } : {}),
      ...(opts.groupId ? { groupId: opts.groupId } : {}),
      ...(opts.programId ? { programId: opts.programId } : {}),
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.visibility === 'public' ? { isPublic: true } :
          opts.visibility === 'hidden' ? { isPublic: false } : {}),
    };
    const take = Math.min(opts.take ?? DEFAULT_TAKE, MAX_TAKE);
    const skip = Math.max(opts.skip ?? 0, 0);

    // Run page query + total count in parallel so the UI can render
    // explicit pagination ("מציג 1-500 מתוך 2347") instead of guessing
    // when more rows exist by checking if the page came back full.
    const [rows, total] = await Promise.all([
      this.prisma.feedEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          participant: { select: { id: true, firstName: true, lastName: true } },
          group: { select: { id: true, name: true } },
          program: { select: { id: true, name: true } },
        },
      }),
      this.prisma.feedEvent.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        type: r.type,
        message: r.message,
        points: r.points,
        isPublic: r.isPublic,
        createdAt: r.createdAt.toISOString(),
        logId: r.logId,
        participant: r.participant
          ? { id: r.participant.id, firstName: r.participant.firstName, lastName: r.participant.lastName ?? null }
          : null,
        group: r.group ? { id: r.group.id, name: r.group.name } : null,
        program: r.program ? { id: r.program.id, name: r.program.name } : null,
      })),
      total,
      skip,
      take,
      hasMore: skip + rows.length < total,
    };
  }
}
