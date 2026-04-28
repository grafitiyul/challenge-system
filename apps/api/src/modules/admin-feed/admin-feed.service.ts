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

const DEFAULT_TAKE = 200;
const MAX_TAKE = 1000;

@Injectable()
export class AdminFeedService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: ListFeedOpts = {}): Promise<AdminFeedRow[]> {
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

    const rows = await this.prisma.feedEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        participant: { select: { id: true, firstName: true, lastName: true } },
        group: { select: { id: true, name: true } },
        program: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => ({
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
    }));
  }
}
