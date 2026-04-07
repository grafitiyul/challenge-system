import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { ParticipantPortalService, PortalContext } from './participant-portal.service';

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

  // GET /api/public/participant/:token
  // Resolves token → full participant context (no auth required)
  @Get(':token')
  getContext(@Param('token') token: string): Promise<PortalContext> {
    return this.portalService.getContext(token);
  }

  // POST /api/public/participant/:token/log
  // Logs an action on behalf of the token owner (no auth required)
  @Post(':token/log')
  logAction(
    @Param('token') token: string,
    @Body() dto: LogActionPortalDto,
  ): Promise<{ pointsEarned: number; todayScore: number; todayValue: number | null }> {
    return this.portalService.logAction(token, dto);
  }
}
