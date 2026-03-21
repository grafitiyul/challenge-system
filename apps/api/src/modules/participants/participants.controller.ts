import { Controller, Get, Post, Body, Query, Param, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ParticipantsService } from './participants.service';
import { CreateParticipantDto } from './dto/create-participant.dto';

@Controller('participants')
export class ParticipantsController {
  constructor(private readonly participantsService: ParticipantsService) {}

  @Get()
  findAll(
    @Query('groupId') groupId?: string,
    @Query('includeMock') includeMock?: string,
  ) {
    const withMock = includeMock === 'true';
    if (groupId) {
      return this.participantsService.findByGroup(groupId, withMock);
    }
    return this.participantsService.findAll(withMock);
  }

  // Declared before @Get(':id') to prevent NestJS treating "mock" as an :id param
  @Post('mock')
  createMock(
    @Query('count', new DefaultValuePipe(10), ParseIntPipe) count: number,
  ) {
    console.log(`POST /participants/mock hit — count=${count}`);
    return this.participantsService.createMock(count);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.participantsService.findById(id);
  }

  @Post()
  create(@Body() dto: CreateParticipantDto) {
    return this.participantsService.create(dto);
  }
}
