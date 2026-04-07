import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { QuestionnairesService } from './questionnaires.service';
import { CreateSubmissionDto } from './dto/create-submission.dto';

// No auth — these routes are hit by external users on their phones
@Controller('public/q')
export class PublicQuestionnairesController {
  constructor(private readonly svc: QuestionnairesService) {}

  @Get('lookup-participant')
  lookupParticipant(@Query('phone') phone: string) {
    return this.svc.lookupParticipantByPhone(phone);
  }

  @Get(':token')
  resolveLink(@Param('token') token: string) {
    return this.svc.resolveExternalLink(token);
  }

  @Post(':token/submit')
  submitExternal(@Param('token') token: string, @Body() dto: CreateSubmissionDto) {
    return this.svc.submitExternal(token, dto);
  }
}
