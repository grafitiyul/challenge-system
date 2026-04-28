import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { AdminFeedService, AdminFeedPage } from './admin-feed.service';

// Admin-only feed audit surface. Lives at /api/admin/feed-events so it
// can never be reached by a participant token. No time limit; includes
// hidden rows; supports filtering by participant / group / program /
// type / visibility.

@UseGuards(AdminSessionGuard)
@Controller('admin/feed-events')
export class AdminFeedController {
  constructor(private readonly svc: AdminFeedService) {}

  @Get()
  list(
    @Query('participantId') participantId?: string,
    @Query('groupId') groupId?: string,
    @Query('programId') programId?: string,
    @Query('type') type?: string,
    @Query('visibility') visibility?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<AdminFeedPage> {
    const v = visibility === 'public' || visibility === 'hidden' ? visibility : 'all';
    return this.svc.list({
      participantId,
      groupId,
      programId,
      type,
      visibility: v,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }
}
