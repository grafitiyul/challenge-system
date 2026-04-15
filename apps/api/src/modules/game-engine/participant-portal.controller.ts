import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
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
  AnalyticsContextDimension,
} from './participant-portal.service';

class LogActionPortalDto {
  @IsString()
  actionId: string;

  @IsOptional()
  @IsString()
  value?: string;

  /**
   * Phase 3: extra dimension values captured by the participant. Validated
   * server-side by validateContext() against the action's contextSchemaJson.
   * Required-field violations / unknown keys / bad option values → 400/422.
   */
  @IsOptional()
  @IsObject()
  contextJson?: Record<string, unknown>;
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
    return this.portalService.logAction(
      token,
      { actionId: dto.actionId, value: dto.value, contextJson: dto.contextJson },
      idempotencyKey,
    );
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
  // Or                                          ?from=YYYY-MM-DD&to=YYYY-MM-DD
  @Get(':token/analytics/trend')
  getAnalyticsTrend(
    @Param('token') token: string,
    @Query('days') days?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AnalyticsTrendPoint[]> {
    const parsedDays = days ? parseInt(days, 10) : undefined;
    return this.portalService.getAnalyticsTrend(token, {
      days: parsedDays,
      from,
      to,
    });
  }

  // GET /api/public/participant/:token/analytics/day?date=YYYY-MM-DD
  @Get(':token/analytics/day')
  getAnalyticsDay(
    @Param('token') token: string,
    @Query('date') date: string,
  ): Promise<AnalyticsDayEntry[]> {
    return this.portalService.getAnalyticsDay(token, date);
  }

  // GET /api/public/participant/:token/analytics/breakdown
  //   ?period=7d|14d|30d|all
  //   or ?from=YYYY-MM-DD&to=YYYY-MM-DD
  //   &groupBy=action (default) | context:<dimensionKey>
  @Get(':token/analytics/breakdown')
  getAnalyticsBreakdown(
    @Param('token') token: string,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
  ): Promise<AnalyticsBreakdownEntry[]> {
    return this.portalService.getAnalyticsBreakdown(token, {
      period: period as '7d' | '14d' | '30d' | 'all' | undefined,
      from,
      to,
      groupBy,
    });
  }

  // GET /api/public/participant/:token/analytics/context-dimensions
  // Returns [{ key, label }] for dimensions that appear in the participant's
  // active log history. Empty array → frontend hides the context toggle.
  @Get(':token/analytics/context-dimensions')
  getAnalyticsContextDimensions(
    @Param('token') token: string,
  ): Promise<AnalyticsContextDimension[]> {
    return this.portalService.getAnalyticsContextDimensions(token);
  }
}
