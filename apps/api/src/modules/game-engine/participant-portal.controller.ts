import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import {
  ParticipantPortalService,
  PortalContext,
  PortalStats,
  PortalFeedItem,
  PortalRules,
  AnalyticsSummary,
  AnalyticsTrendPoint,
  AnalyticsDayEntry,
  AnalyticsBreakdownEntry,
} from './participant-portal.service';

class LogActionPortalDto {
  @IsString()
  actionId: string;

  @IsOptional()
  @IsString()
  value?: string;
}

@Controller('public/participant')
export class ParticipantPortalController {
  constructor(private readonly portalService: ParticipantPortalService) {}

  // GET /api/public/participant/:token?_bypass=sig
  // Optional _bypass query param: HMAC-signed sig enabling admin preview without the opening gate
  @Get(':token')
  getContext(
    @Param('token') token: string,
    @Query('_bypass') bypass?: string,
  ): Promise<PortalContext> {
    return this.portalService.getContext(token, bypass);
  }

  // POST /api/public/participant/:token/log
  //
  // Accepts the optional HTTP header `Idempotency-Key`. Retries that carry the
  // same key collapse to one stored submission and return the original result.
  @Post(':token/log')
  logAction(
    @Param('token') token: string,
    @Body() dto: LogActionPortalDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<{ pointsEarned: number; todayScore: number; todayValue: number | null }> {
    return this.portalService.logAction(token, dto, idempotencyKey);
  }

  // GET /api/public/participant/:token/stats
  @Get(':token/stats')
  getStats(@Param('token') token: string): Promise<PortalStats> {
    return this.portalService.getPortalStats(token);
  }

  // GET /api/public/participant/:token/feed
  @Get(':token/feed')
  getFeed(@Param('token') token: string): Promise<PortalFeedItem[]> {
    return this.portalService.getPortalFeed(token);
  }

  // GET /api/public/participant/:token/rules
  @Get(':token/rules')
  getRules(@Param('token') token: string): Promise<PortalRules> {
    return this.portalService.getPortalRules(token);
  }

  // ─── Phase 2A: participant analytics ─────────────────────────────────────
  // All four endpoints are scoped to the participant behind :token and read
  // strictly from the ScoreEvent ledger + active UserActionLogs.

  // GET /api/public/participant/:token/analytics/summary
  @Get(':token/analytics/summary')
  getAnalyticsSummary(@Param('token') token: string): Promise<AnalyticsSummary> {
    return this.portalService.getAnalyticsSummary(token);
  }

  // GET /api/public/participant/:token/analytics/trend?days=7|14|30
  @Get(':token/analytics/trend')
  getAnalyticsTrend(
    @Param('token') token: string,
    @Query('days') days?: string,
  ): Promise<AnalyticsTrendPoint[]> {
    const n = days ? parseInt(days, 10) : 14;
    return this.portalService.getAnalyticsTrend(token, n);
  }

  // GET /api/public/participant/:token/analytics/day?date=YYYY-MM-DD
  @Get(':token/analytics/day')
  getAnalyticsDay(
    @Param('token') token: string,
    @Query('date') date: string,
  ): Promise<AnalyticsDayEntry[]> {
    return this.portalService.getAnalyticsDay(token, date);
  }

  // GET /api/public/participant/:token/analytics/breakdown?period=7d|14d|30d|all
  @Get(':token/analytics/breakdown')
  getAnalyticsBreakdown(
    @Param('token') token: string,
    @Query('period') period?: string,
  ): Promise<AnalyticsBreakdownEntry[]> {
    const p = (period ?? '7d') as '7d' | '14d' | '30d' | 'all';
    return this.portalService.getAnalyticsBreakdown(token, p);
  }
}
