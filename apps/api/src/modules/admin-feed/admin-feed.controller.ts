import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { AdminFeedService, AdminFeedPage } from './admin-feed.service';
import { AdminFeedEditDto } from './dto/admin-feed-edit.dto';

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

  // POST /api/admin/feed-events/:id/void
  //
  // Log-linked rows route through gameEngine.voidLog (compensating
  // ScoreEvents per fan-out group + isPublic=false on every linked
  // FeedEvent + threshold-rule recompute). Standalone rows just flip
  // isPublic on the single FeedEvent row.
  @Post(':id/void')
  void(@Param('id') id: string) {
    return this.svc.voidByFeedEventId(id);
  }

  // PATCH /api/admin/feed-events/:id
  //
  // Log-linked rows: caller must send `value`; engine.correctLog
  // recomputes scoring across every fanned-out group.
  // Standalone rows: caller may send `message` and/or `isPublic`;
  // only the FeedEvent row is updated.
  @Patch(':id')
  edit(@Param('id') id: string, @Body() dto: AdminFeedEditDto) {
    return this.svc.editByFeedEventId(id, dto);
  }
}
