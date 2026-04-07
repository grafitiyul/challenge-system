import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { ParticipantPortalService } from './participant-portal.service';

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
  getContext(@Param('token') token: string) {
    return this.portalService.getContext(token);
  }

  // POST /api/public/participant/:token/log
  // Logs an action on behalf of the token owner (no auth required)
  @Post(':token/log')
  logAction(@Param('token') token: string, @Body() dto: LogActionPortalDto) {
    return this.portalService.logAction(token, dto);
  }
}
