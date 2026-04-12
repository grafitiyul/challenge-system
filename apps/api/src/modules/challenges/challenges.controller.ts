import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';

@UseGuards(AdminSessionGuard)
@Controller('challenges')
export class ChallengesController {
  constructor(private readonly challengesService: ChallengesService) {}

  @Get()
  findAll() {
    return this.challengesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateChallengeDto) {
    return this.challengesService.create(dto);
  }
}
