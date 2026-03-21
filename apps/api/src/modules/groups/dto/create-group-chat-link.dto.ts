import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateGroupChatLinkDto {
  @IsString()
  whatsappChatId: string;

  @IsIn(['group_chat', 'private_participant_chat'])
  linkType: 'group_chat' | 'private_participant_chat';

  @IsString()
  @IsOptional()
  participantId?: string;
}
