import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { PrivateScheduledMessagesService } from './private-messages.service';
import {
  CreatePrivateScheduledMessageDto,
  SendNowDto,
  UpdatePrivateScheduledMessageDto,
} from './dto/private-message.dto';

// Routes for the participant-private-DM scheduling surface. Lives
// under /participants/:id so both the participant profile chat tab
// and the group-list WA popup hit the same endpoints — they share
// participantId as the only key.
@UseGuards(AdminSessionGuard)
@Controller('participants/:participantId')
export class ParticipantPrivateMessagesController {
  constructor(private readonly svc: PrivateScheduledMessagesService) {}

  @Get('scheduled-messages')
  list(@Param('participantId') participantId: string) {
    return this.svc.list(participantId);
  }

  @Post('scheduled-messages')
  create(
    @Param('participantId') participantId: string,
    @Body() dto: CreatePrivateScheduledMessageDto,
  ) {
    return this.svc.create(participantId, dto);
  }

  @Patch('scheduled-messages/:msgId')
  update(
    @Param('participantId') participantId: string,
    @Param('msgId') msgId: string,
    @Body() dto: UpdatePrivateScheduledMessageDto,
  ) {
    return this.svc.update(participantId, msgId, dto);
  }

  @Post('scheduled-messages/:msgId/cancel')
  cancel(
    @Param('participantId') participantId: string,
    @Param('msgId') msgId: string,
  ) {
    // adminId is not captured by the existing controller convention —
    // the AdminSessionGuard validates the session but doesn't expose
    // the admin id on the request shape. Pass null for now; the column
    // is nullable so audit-trail tooling can later upgrade this once
    // the convention changes for all controllers.
    return this.svc.cancel(participantId, msgId, null);
  }

  // Send-now passthrough — does NOT create a PrivateScheduledMessage
  // row. The bridge persists the outbound to WhatsAppMessage with
  // direction='outgoing' and the chat-timeline endpoint reads it from
  // there. Single source of truth for "what was already sent."
  @Post('messages/send-now')
  sendNow(
    @Param('participantId') participantId: string,
    @Body() dto: SendNowDto,
  ) {
    return this.svc.sendNow(participantId, dto.content);
  }

  // Unified chat view: WhatsApp inbound + outbound (from
  // WhatsAppMessage joined through the participant's private chat) +
  // pending/failed/cancelled scheduled rows.
  @Get('chat')
  chat(@Param('participantId') participantId: string) {
    return this.svc.chatTimeline(participantId);
  }
}

// Per-group participant-list badge endpoint. Returns one count per
// participantId for "still-pending private scheduled messages." Lives
// under groups/:id so the group page can grab everything it needs in
// one round trip rather than fanning out per row.
@UseGuards(AdminSessionGuard)
@Controller('groups/:groupId')
export class GroupParticipantsScheduledCountsController {
  constructor(private readonly svc: PrivateScheduledMessagesService) {}

  @Get('participant-scheduled-counts')
  async counts(
    @Param('groupId') groupId: string,
    @Query('participantIds') participantIdsCsv?: string,
  ) {
    if (!participantIdsCsv || !participantIdsCsv.trim()) {
      throw new BadRequestException('participantIds query parameter is required');
    }
    const ids = participantIdsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) return {};
    if (ids.length > 500) {
      throw new BadRequestException('יותר מדי מזהי משתתפות בבקשה אחת');
    }
    return this.svc.countsForParticipants(ids);
  }

  // Personal broadcast — sends a single body privately to a hand-
  // picked subset of group members. Each participant gets one
  // PrivateScheduledMessage row, rendered with her own variable
  // context. Unresolved variables block her row from being created
  // (server-enforced safety). Pacing/retry/no-double-send all come
  // from the existing scheduled-messages worker, which picks up
  // sendMode='now' rows on its next minute tick.
  @Post('messages/private-broadcast')
  privateBroadcast(
    @Param('groupId') groupId: string,
    @Body() body: {
      content?: string;
      participantIds?: string[];
      sendMode?: 'now' | 'schedule';
      scheduledAt?: string;
    },
  ) {
    if (!body.content || !Array.isArray(body.participantIds) || !body.sendMode) {
      throw new BadRequestException('שדות חובה: content, participantIds, sendMode');
    }
    if (body.sendMode !== 'now' && body.sendMode !== 'schedule') {
      throw new BadRequestException('sendMode חייב להיות now או schedule');
    }
    return this.svc.privateBroadcast(groupId, {
      content: body.content,
      participantIds: body.participantIds,
      sendMode: body.sendMode,
      scheduledAt: body.scheduledAt,
    });
  }
}
