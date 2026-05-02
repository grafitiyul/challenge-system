import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { GroupScheduledMessagesService } from './group-messages.service';
import {
  CreateGroupMessageDto,
  UpdateGroupMessageDto,
  InheritFromProgramDto,
  SetGroupMasterToggleDto,
} from './dto/group-message.dto';

// Group-level scheduled messages. THIS is the only table the cron
// worker reads from. Master toggle on Group + per-row enabled flag +
// status='pending' all gate the actual send.

@UseGuards(AdminSessionGuard)
@Controller('groups/:groupId/scheduled-messages')
export class GroupScheduledMessagesController {
  constructor(private readonly svc: GroupScheduledMessagesService) {}

  @Get()
  list(@Param('groupId') groupId: string) {
    return this.svc.list(groupId);
  }

  @Patch('master-toggle')
  setMaster(
    @Param('groupId') groupId: string,
    @Body() dto: SetGroupMasterToggleDto,
  ) {
    return this.svc.setMasterToggle(groupId, dto.scheduledMessagesEnabled);
  }

  @Post()
  create(@Param('groupId') groupId: string, @Body() dto: CreateGroupMessageDto) {
    return this.svc.create(groupId, dto);
  }

  @Patch(':msgId')
  update(
    @Param('groupId') groupId: string,
    @Param('msgId') msgId: string,
    @Body() dto: UpdateGroupMessageDto,
  ) {
    return this.svc.update(groupId, msgId, dto);
  }

  // Status transitions to 'cancelled'. Terminal — admin must create a
  // new row to re-send.
  @Post(':msgId/cancel')
  cancel(@Param('groupId') groupId: string, @Param('msgId') msgId: string) {
    return this.svc.cancel(groupId, msgId);
  }

  // Bulk-import templates from the group's program. Cloned rows start
  // as draft + disabled — admin must approve each one before the cron
  // can execute.
  @Post('inherit-from-program')
  inherit(
    @Param('groupId') groupId: string,
    @Body() dto: InheritFromProgramDto,
  ) {
    return this.svc.inheritFromProgram(groupId, dto);
  }
}
