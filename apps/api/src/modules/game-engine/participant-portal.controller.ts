import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
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
  AnalyticsSliceEntry,
  AnalyticsInsight,
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

  /** Phase 4.1: free-text answer to action.participantTextPrompt (if set). */
  @IsOptional()
  @IsString()
  extraText?: string;

  /**
   * Phase 8 — per-group scoring. The active group the participant is
   * viewing when she logs. Server validates that this group belongs to
   * her active memberships in the same program; falls back silently to
   * the primary group when missing or invalid (single-group + flag-off
   * participants behave exactly as before).
   */
  @IsOptional()
  @IsString()
  groupId?: string;
}

// Phase 6.11: body for participant-scoped log editing.
class EditLogPortalDto {
  @IsString()
  value: string;
}

@Controller('public/participant')
export class ParticipantPortalController {
  constructor(private readonly portalService: ParticipantPortalService) {}

  // GET /api/public/participant/:token?_bypass=sig&groupId=<id>
  // Optional _bypass query param: HMAC-signed sig enabling admin preview without the opening gate
  // Optional groupId query param (Phase 8): chooses which group's
  // member-set the leaderboard / feed scope to. Falls back silently to
  // the participant's primary (oldest active) group when missing or
  // pointing at a group she does not belong to.
  @Get(':token')
  getContext(
    @Param('token') token: string,
    @Query('_bypass') bypass?: string,
    @Query('groupId') groupId?: string,
  ): Promise<PortalContext> {
    return this.portalService.getContext(token, bypass, groupId);
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
      {
        actionId: dto.actionId,
        value: dto.value,
        contextJson: dto.contextJson,
        extraText: dto.extraText,
        groupId: dto.groupId,
      },
      idempotencyKey,
    );
  }

  // Phase 6.11: PATCH /api/public/participant/:token/logs/:logId
  //
  // Participant-scoped edit of their OWN same-day log. Delegates to the
  // existing GameEngineService.correctLog — no new business logic. Server
  // verifies ownership (log belongs to this token's participant) and that
  // the log was created today; past-day logs are read-only.
  @Patch(':token/logs/:logId')
  editOwnLog(
    @Param('token') token: string,
    @Param('logId') logId: string,
    @Body() dto: EditLogPortalDto,
  ) {
    return this.portalService.editOwnLog(token, logId, { value: dto.value });
  }

  // Phase 6.11: DELETE /api/public/participant/:token/logs/:logId
  //
  // Participant-scoped void of their own same-day log. Same ownership +
  // today-only constraints as edit. Uses GameEngineService.voidLog, which
  // triggers the units-delta cascade + threshold-rule recompute.
  @Delete(':token/logs/:logId')
  deleteOwnLog(
    @Param('token') token: string,
    @Param('logId') logId: string,
  ) {
    return this.portalService.deleteOwnLog(token, logId);
  }

  // GET /api/public/participant/:token/stats
  // Optional Phase 8 ?groupId=: leaderboard scopes to the selected group's members.
  @Get(':token/stats')
  getStats(
    @Param('token') token: string,
    @Query('groupId') groupId?: string,
  ): Promise<PortalStats> {
    return this.portalService.getPortalStats(token, groupId);
  }

  // GET /api/public/participant/:token/feed
  // Optional Phase 8 ?groupId=: feed scopes to the selected group's members.
  @Get(':token/feed')
  getFeed(
    @Param('token') token: string,
    @Query('groupId') groupId?: string,
  ): Promise<PortalFeedItem[]> {
    return this.portalService.getPortalFeed(token, groupId);
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

  // GET /api/public/participant/:token/analytics/insights
  //   ?period=7d|14d|30d|all  OR  ?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Phase 6: deterministic insights engine. Returns 0–4 short Hebrew lines
  // summarizing the most important patterns in the participant's data for the
  // requested range. No AI, no randomness — pure ledger-derived scoring.
  @Get(':token/analytics/insights')
  getAnalyticsInsights(
    @Param('token') token: string,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AnalyticsInsight[]> {
    return this.portalService.getAnalyticsInsights(token, {
      period: period as '7d' | '14d' | '30d' | 'all' | undefined,
      from,
      to,
    });
  }

  // GET /api/public/participant/:token/analytics/slice-drilldown
  //   ?groupBy=context:<key> | group:<groupId>
  //   &value=<raw value>
  //   &period=7d|14d|30d|all  OR  &from=YYYY-MM-DD&to=YYYY-MM-DD
  @Get(':token/analytics/slice-drilldown')
  getAnalyticsSliceDrilldown(
    @Param('token') token: string,
    @Query('groupBy') groupBy: string,
    @Query('value') value: string,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AnalyticsSliceEntry[]> {
    return this.portalService.getAnalyticsSliceDrilldown(token, {
      groupBy,
      value,
      period: period as '7d' | '14d' | '30d' | 'all' | undefined,
      from,
      to,
    });
  }
}
