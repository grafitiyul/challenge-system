import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import {
  ParticipantPortalService,
  PortalContext,
  PortalStats,
  PortalFeedItem,
  PortalRules,
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
  @Post(':token/log')
  logAction(
    @Param('token') token: string,
    @Body() dto: LogActionPortalDto,
  ): Promise<{ pointsEarned: number; todayScore: number; todayValue: number | null }> {
    return this.portalService.logAction(token, dto);
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
}
