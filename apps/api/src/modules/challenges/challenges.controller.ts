import { Controller, Get, Post, Body } from '@nestjs/common';
import { ChallengesService } from './challenges.service';
import { CreateChallengeDto } from './dto/create-challenge.dto';

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
