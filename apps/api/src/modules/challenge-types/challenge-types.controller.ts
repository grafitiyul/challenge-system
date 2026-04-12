import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { AdminSessionGuard } from '../auth/admin-session.guard';
import { ChallengeTypesService } from './challenge-types.service';
import { CreateChallengeTypeDto } from './dto/create-challenge-type.dto';

@UseGuards(AdminSessionGuard)
@Controller('challenge-types')
export class ChallengeTypesController {
  constructor(private readonly challengeTypesService: ChallengeTypesService) {}

  @Get()
  findAll() {
    return this.challengeTypesService.findAll();
  }

  @Post()
  create(@Body() dto: CreateChallengeTypeDto) {
    return this.challengeTypesService.create(dto);
  }
}
